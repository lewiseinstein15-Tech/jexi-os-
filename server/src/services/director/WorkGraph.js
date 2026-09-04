/**
 * B211 — WORK GRAPH: the authoritative task state for a mission.
 *
 * A mission's work is a PERSISTED graph, not chat state: work items (nodes)
 * with statuses + typed relations (edges). It survives refresh, restart and
 * crashes (atomic JSON under DATA_DIR/missions/<missionId>/graph.json), and it
 * is the ONLY source of truth for what is done, what is ready, and what is
 * blocked. The chat/frontend renders it; it never invents it.
 *
 * Work item statuses:
 *   PENDING     not started (ready-ness is DERIVED, never stored)
 *   RUNNING     claimed + in flight (protected by a lease)
 *   DONE        completed with a real result (content, artifacts, hashes)
 *   FAILED      failed after the recovery ladder (retryable via retry())
 *   SKIPPED     intentionally skipped (recorded honestly, resolves blockers)
 *   SUPERSEDED  replaced by another item (steering/discovery); resolves blockers
 *
 * Relations (typed, directed):
 *   BLOCKS          from blocks to (to waits for from)
 *   DISCOVERED_FROM item was discovered while executing `to`
 *   SUPERSEDES      new item replaces the old one (inherits its blocking role)
 *   PRODUCES        item produced an artifact (name recorded)
 *
 * Ready-work is DETERMINISTIC: priority weight desc, then createdAt asc, then
 * id asc. Same graph → same order, always.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DATA_DIR } from '../../config.js';

const MISSIONS_DIR = path.join(DATA_DIR, 'missions');

export const WORK_STATUSES = ['PENDING', 'RUNNING', 'DONE', 'FAILED', 'SKIPPED', 'SUPERSEDED'];
export const RELATION_TYPES = ['BLOCKS', 'DISCOVERED_FROM', 'SUPERSEDES', 'PRODUCES'];
/** Statuses that unblock dependents (a superseded/skipped blocker no longer waits). */
const RESOLVED = new Set(['DONE', 'SKIPPED', 'SUPERSEDED']);
const PRIORITY_WEIGHT = { high: 3, normal: 2, low: 1 };

let __seq = 0;
const nextItemId = () => `wi-${Date.now().toString(36)}-${String(++__seq).padStart(3, '0')}`;

export const sha256 = (text) => crypto.createHash('sha256').update(String(text || '')).digest('hex');

export class WorkGraph {
  constructor(missionId) {
    this.missionId = String(missionId);
    this.items = [];      // work items
    this.relations = [];  // typed edges
    this.leases = {};     // itemId → { workerId, expiresAt (ms epoch) }
  }

  /* ── construction ─────────────────────────────────────────────────── */

  addItem(def) {
    const item = {
      id: nextItemId(),
      planIndex: def.planIndex || null,     // 1-based position in the plan (st1, st2… for brief deps)
      title: String(def.title || 'untitled work').slice(0, 200),
      details: String(def.details || '').slice(0, 4000),
      capability: String(def.capability || 'reasoning').slice(0, 40),
      requirements: Array.isArray(def.requirements) ? def.requirements.slice(0, 6) : [],
      expectedOutput: String(def.expectedOutput || '').slice(0, 500),
      priority: ['high', 'normal', 'low'].includes(def.priority) ? def.priority : 'normal',
      status: 'PENDING',
      origin: def.origin === 'DISCOVERED' ? 'DISCOVERED' : 'PLAN',
      classification: def.classification || null,  // EXECUTE_NOW | QUEUE | DELEGATE | DEFER | IGNORE_WITH_REASON (discovered only)
      deferred: Boolean(def.deferred),
      searchQueries: Array.isArray(def.searchQueries) ? def.searchQueries.slice(0, 3) : [],
      dependsOn: Array.isArray(def.dependsOn) ? def.dependsOn.slice() : [], // planIndex numbers
      result: null,        // { content, artifacts:[{name,bytes,sha256}], employeeId, ms, confidence }
      attempts: 0,
      failureReason: null,
      createdAt: new Date().toISOString(),
      updatedAt: this.createdAtSlot(),
    };
    this.items.push(item);
    this._persist();
    return item;
  }

  createdAtSlot() { return new Date().toISOString(); }

  addRelation(type, from, to, note = '') {
    if (!RELATION_TYPES.includes(type)) throw new Error(`WorkGraph: unknown relation type ${type}`);
    if (!this.items.some((i) => i.id === from) || !this.items.some((i) => i.id === to)) {
      throw new Error(`WorkGraph: relation ${type} references unknown item (${from} → ${to})`);
    }
    // no duplicate edges
    if (!this.relations.some((r) => r.type === type && r.from === from && r.to === to)) {
      this.relations.push({ type, from, to, at: new Date().toISOString(), note: String(note || '').slice(0, 300) });
      this._persist();
    }
  }

  get(id) { return this.items.find((i) => i.id === id) || null; }

  /* ── the ready-work engine (deterministic) ────────────────────────── */

  /** Item ids that block `item` (via BLOCKS relations pointing at it). */
  blockersOf(itemId) {
    return this.relations.filter((r) => r.type === 'BLOCKS' && r.to === itemId).map((r) => this.get(r.from)).filter(Boolean);
  }

  _leaseLive(itemId, now = Date.now()) {
    const l = this.leases[itemId];
    return Boolean(l && l.expiresAt > now);
  }

  /**
   * Deterministic ready-work query: not deferred, all blockers resolved
   * (DONE/SKIPPED/SUPERSEDED), and not held by a live lease. A RUNNING item
   * whose lease EXPIRED is stale work (its worker died without cleanup) and
   * is reclaimable; a live lease protects in-flight work.
   */
  readyWork(now = Date.now()) {
    return this.items
      .filter((i) => !i.deferred)
      .filter((i) => (i.status === 'PENDING' || i.status === 'RUNNING') && !this._leaseLive(i.id, now))
      .filter((i) => this.blockersOf(i.id).every((b) => RESOLVED.has(b.status)))
      .sort((a, b) =>
        (PRIORITY_WEIGHT[b.priority] || 2) - (PRIORITY_WEIGHT[a.priority] || 2) ||
        String(a.createdAt).localeCompare(String(b.createdAt)) ||
        String(a.id).localeCompare(String(b.id)));
  }

  /** Claim a ready item (lease). Returns the item or null (not claimable). */
  claim(itemId, workerId, ttlMs = 10 * 60 * 1000) {
    const item = this.get(itemId);
    if (!item || item.deferred) return null;
    const reclaimable = item.status === 'PENDING' || (item.status === 'RUNNING' && !this._leaseLive(itemId));
    if (!reclaimable) return null;
    if (this._leaseLive(itemId)) return null;
    if (!this.blockersOf(itemId).every((b) => RESOLVED.has(b.status))) return null;
    this.leases[itemId] = { workerId: String(workerId), expiresAt: Date.now() + ttlMs, at: new Date().toISOString() };
    item.status = 'RUNNING';
    item.updatedAt = new Date().toISOString();
    this._persist();
    return item;
  }

  releaseLease(itemId) { delete this.leases[itemId]; this._persist(); }

  /** Complete with a real result. Artifacts get content hashes (never trust a name). */
  complete(itemId, result) {
    const item = this.get(itemId);
    if (!item) throw new Error(`WorkGraph.complete: unknown item ${itemId}`);
    if (item.status !== 'RUNNING' && item.status !== 'PENDING') {
      throw new Error(`WorkGraph.complete: item ${itemId} is ${item.status}, not completable`);
    }
    const artifacts = (result.artifacts || []).slice(0, 40).map((a) => ({
      name: String(a.name || 'artifact').slice(0, 160),
      bytes: Number(a.bytes || String(a.content || '').length || 0),
      sha256: a.sha256 || sha256(a.content || a.name || ''),
    }));
    item.status = 'DONE';
    item.result = {
      content: String(result.content || '').slice(0, 12000),
      artifacts,
      employeeId: result.employeeId || null,
      employeeName: result.employeeName || null,
      ms: Number(result.ms || 0),
      confidence: result.confidence || null,
      commandsExecuted: Number(result.commandsExecuted || 0),
    };
    item.updatedAt = new Date().toISOString();
    delete this.leases[itemId];
    this._persist();
    return item;
  }

  fail(itemId, reason) {
    const item = this.get(itemId);
    if (!item) throw new Error(`WorkGraph.fail: unknown item ${itemId}`);
    if (item.status === 'DONE' || item.status === 'SUPERSEDED') return item; // terminal states keep their record
    item.status = 'FAILED';
    item.attempts += 1;
    item.failureReason = String(reason || 'unknown failure').slice(0, 500);
    item.updatedAt = new Date().toISOString();
    delete this.leases[itemId];
    this._persist();
    return item;
  }

  /** Requeue a FAILED item (user retry control / mission replan). */
  retry(itemId) {
    const item = this.get(itemId);
    if (!item) throw new Error(`WorkGraph.retry: unknown item ${itemId}`);
    if (item.status !== 'FAILED') throw new Error(`WorkGraph.retry: item ${itemId} is ${item.status}`);
    item.status = 'PENDING';
    item.failureReason = null;
    item.updatedAt = new Date().toISOString();
    this._persist();
    return item;
  }

  skip(itemId, reason = '') {
    const item = this.get(itemId);
    if (!item) throw new Error(`WorkGraph.skip: unknown item ${itemId}`);
    if (['DONE', 'SUPERSEDED', 'SKIPPED'].includes(item.status)) return item;
    item.status = 'SKIPPED';
    item.failureReason = String(reason || 'skipped by user').slice(0, 300);
    item.updatedAt = new Date().toISOString();
    delete this.leases[itemId];
    this._persist();
    return item;
  }

  /** Put a RUNNING item back to PENDING without counting a failure (NEEDS pause, restart recovery). */
  requeue(itemId, reason = '') {
    const item = this.get(itemId);
    if (!item) throw new Error(`WorkGraph.requeue: unknown item ${itemId}`);
    if (item.status === 'DONE') return item;
    item.status = 'PENDING';
    item.failureReason = String(reason || '').slice(0, 300) || item.failureReason;
    item.updatedAt = new Date().toISOString();
    delete this.leases[itemId];
    this._persist();
    return item;
  }

  /**
   * Supersede an item (steering / discovery replaced it). The replacement
   * INHERITS the old item's blocking role so dependents now wait on the new
   * work. Returns the superseded item.
   */
  supersede(itemId, supersededById, reason = '') {
    const old = this.get(itemId);
    if (!old) throw new Error(`WorkGraph.supersede: unknown item ${itemId}`);
    if (['DONE', 'SKIPPED', 'FAILED', 'SUPERSEDED'].includes(old.status)) {
      throw new Error(`WorkGraph.supersede: item ${itemId} is already terminal (${old.status})`);
    }
    old.status = 'SUPERSEDED';
    old.failureReason = String(reason || '').slice(0, 300);
    old.updatedAt = new Date().toISOString();
    delete this.leases[itemId];
    if (supersededById && supersededById !== itemId) {
      this.addRelation('SUPERSEDES', supersededById, itemId, reason);
      // inherit the blocking role: everything old blocked is now blocked by the replacement
      for (const r of this.relations.filter((r) => r.type === 'BLOCKS' && r.from === itemId)) {
        if (!this.relations.some((x) => x.type === 'BLOCKS' && x.from === supersededById && x.to === r.to)) {
          this.relations.push({ type: 'BLOCKS', from: supersededById, to: r.to, at: new Date().toISOString(), note: `inherited from superseded ${itemId}` });
        }
      }
    }
    this._persist();
    return old;
  }

  /** Promote a deferred item back into ready consideration. */
  promote(itemId) {
    const item = this.get(itemId);
    if (!item) throw new Error(`WorkGraph.promote: unknown item ${itemId}`);
    item.deferred = false;
    item.classification = 'PROMOTED';
    item.updatedAt = new Date().toISOString();
    this._persist();
    return item;
  }

  /**
   * Invalidate the affected sub-tree for mid-mission steering: supersede every
   * open (PENDING/RUNNING) item downstream of the given items (transitive),
   * plus the items themselves if requested. Returns the superseded ids.
   */
  invalidateDownstream(itemIds, supersededById = null, reason = '') {
    const affected = new Set();
    const queue = [...itemIds];
    while (queue.length) {
      const id = queue.shift();
      if (affected.has(id)) continue;
      const item = this.get(id);
      if (!item || ['DONE', 'SKIPPED', 'FAILED', 'SUPERSEDED'].includes(item.status)) continue;
      affected.add(id);
      for (const r of this.relations.filter((r) => r.type === 'BLOCKS' && r.from === id)) queue.push(r.to);
    }
    for (const id of affected) { try { this.supersede(id, supersededById, reason); } catch { /* already terminal */ } }
    return [...affected];
  }

  /* ── restart recovery ─────────────────────────────────────────────── */

  /**
   * Boot-time recovery after a crash/restart: every RUNNING item goes back to
   * PENDING (it did not finish — honest) and all leases are cleared (their
   * worker processes are gone). DONE items and their results are untouched.
   */
  recoverAfterRestart(reason = 'restart') {
    const requeued = [];
    for (const item of this.items) {
      if (item.status === 'RUNNING') { requeued.push(item.id); this.requeue(item.id, `requeued after ${reason}`); }
    }
    this.leases = {};
    this._persist();
    return requeued;
  }

  /* ── stats + persistence ──────────────────────────────────────────── */

  stats() {
    const by = { PENDING: 0, RUNNING: 0, DONE: 0, FAILED: 0, SKIPPED: 0, SUPERSEDED: 0 };
    for (const i of this.items) by[i.status] = (by[i.status] || 0) + 1;
    const open = this.items.filter((i) => i.status === 'PENDING' && !i.deferred);
    const blocked = open.filter((i) => this.blockersOf(i.id).some((b) => b.status === 'FAILED'));
    return {
      total: this.items.length,
      byStatus: by,
      ready: this.readyWork().length,
      open: open.length,
      deferred: this.items.filter((i) => i.deferred && i.status === 'PENDING').length,
      blockedByFailures: blocked.length,
      artifacts: this.items.reduce((n, i) => n + (i.result?.artifacts?.length || 0), 0),
    };
  }

  _dir() { return path.join(MISSIONS_DIR, this.missionId); }
  _file() { return path.join(this._dir(), 'graph.json'); }

  _persist() {
    try {
      fs.mkdirSync(this._dir(), { recursive: true });
      const tmp = `${this._file()}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ missionId: this.missionId, items: this.items, relations: this.relations, leases: this.leases }));
      fs.renameSync(tmp, this._file()); // atomic: a graph is never half-written
    } catch { /* persistence is best-effort; the live run never blocks on disk */ }
  }
}

/** Load a persisted graph (or null). */
export function loadWorkGraph(missionId) {
  try {
    const safe = String(missionId).replace(/[^a-z0-9-]/gi, '_').slice(0, 80);
    const raw = JSON.parse(fs.readFileSync(path.join(MISSIONS_DIR, safe, 'graph.json'), 'utf-8'));
    const g = new WorkGraph(raw.missionId || safe);
    g.items = Array.isArray(raw.items) ? raw.items : [];
    g.relations = Array.isArray(raw.relations) ? raw.relations : [];
    g.leases = raw.leases && typeof raw.leases === 'object' ? raw.leases : {};
    return g;
  } catch { return null; }
}

/**
 * B211 — MISSION: the persistent long-horizon unit of work under the Director.
 *
 * A mission owns a WorkGraph (the authoritative task state) and adds:
 *   - a VALIDATED state machine (illegal transitions throw — loud in tests)
 *   - BUDGETS (max items, max failures, wall-clock) with honest exhaustion
 *     (PAUSED with a reason, never a fake completion)
 *   - USER CONTROLS (pause / resume / cancel / retry / skip / promote)
 *   - a CHECKPOINTED record (mission.json, atomic) + an append-only,
 *     chain-of-events mission log (events.jsonl) for replay after reconnect
 *
 * States:
 *   CREATED → PLANNING → EXECUTING → VERIFYING → COMPLETED
 *   EXECUTING → AWAITING_INPUT (a blocking NEEDS question) → EXECUTING
 *   EXECUTING → PAUSED (user pause OR budget exhausted) → EXECUTING
 *   any active state → CANCELLED; terminal failures → FAILED
 */

import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../../config.js';

const MISSIONS_DIR = path.join(DATA_DIR, 'missions');

const TRANSITIONS = {
  CREATED: ['PLANNING', 'CANCELLED'],
  PLANNING: ['EXECUTING', 'AWAITING_INPUT', 'PAUSED', 'FAILED', 'CANCELLED'],
  EXECUTING: ['VERIFYING', 'AWAITING_INPUT', 'PAUSED', 'FAILED', 'CANCELLED'],
  AWAITING_INPUT: ['EXECUTING', 'PLANNING', 'PAUSED', 'CANCELLED'],
  PAUSED: ['EXECUTING', 'AWAITING_INPUT', 'CANCELLED'],
  VERIFYING: ['COMPLETED', 'EXECUTING', 'FAILED', 'CANCELLED'],
  COMPLETED: [],
  FAILED: ['EXECUTING'], // the ONLY re-entry: an explicit user retry of failed work
  CANCELLED: [],
};

export const MISSION_ACTIVE_STATES = ['PLANNING', 'EXECUTING', 'AWAITING_INPUT', 'VERIFYING'];
export const MISSION_RESUMABLE_STATES = [...MISSION_ACTIVE_STATES, 'PAUSED'];

export const DEFAULT_BUDGETS = {
  maxItems: 24,          // total work items the graph may hold
  maxFailures: 8,        // mission-wide failed items before honest failure
  wallClockMs: 30 * 60 * 1000, // per budget window
  maxDiscoveryRounds: 6, // how many discovered-work batches may be ingested
};

let __seq = 0;
const nextMissionId = () => `ms-${Date.now().toString(36)}-${String(++__seq).padStart(3, '0')}`;

/** Cross-instance event sequence guard: two Mission objects for the same id
 *  (runner + a control API call) must never emit the same event id. */
const __eventSeq = new Map();

export class Mission {
  constructor({ conversationId, objective, rawRequest = '', contextBlock = '', memoryContext = '', budgets = {} }) {
    this.id = nextMissionId();
    this.conversationId = String(conversationId || 'default').slice(0, 120);
    this.objective = String(objective || '').slice(0, 2000);
    this.rawRequest = String(rawRequest || '').slice(0, 4000);
    this.contextBlock = String(contextBlock || '').slice(0, 2000);
    this.memoryContext = String(memoryContext || '').slice(0, 1500);
    this.state = 'CREATED';
    this.createdAt = new Date().toISOString();
    this.updatedAt = this.createdAt;

    this.assumptions = [];
    this.constraints = [];
    this.successCriteria = [];

    this.budgets = { ...DEFAULT_BUDGETS, ...budgets };
    this.usage = {
      itemsCreated: 0,
      failures: 0,
      replans: 0,
      discoveryRounds: 0,
      budgetWindows: 1,
      windowStartedAt: this.createdAt,
      restarts: 0,
    };

    this.steeringQueue = [];    // [{ at, message }] — applied on the next runner tick
    this.needsQuestion = null;  // { itemId, question, at } when AWAITING_INPUT
    this.awaitingAnswerFor = null;
    this.verification = null;   // { verdict, score, problems, rationale }
    this.result = null;         // { summary, stats }
    this.error = null;
    this.pausedReason = null;

    this.eventSeq = 0;          // persisted counter for chained event ids
    this._persist();
  }

  get isTerminal() { return ['COMPLETED', 'FAILED', 'CANCELLED'].includes(this.state); }
  get isActive() { return MISSION_ACTIVE_STATES.includes(this.state); }
  get isResumable() { return !this.isTerminal; }

  setState(next, why = '') {
    const allowed = TRANSITIONS[this.state] || [];
    if (!allowed.includes(next)) {
      throw new Error(`Mission: illegal transition ${this.state} → ${next}${why ? ` (${why})` : ''}`);
    }
    this.state = next;
    this.updatedAt = new Date().toISOString();
    this._persist();
    return this;
  }

  /* ── budgets ──────────────────────────────────────────────────────── */

  windowElapsedMs(now = Date.now()) { return now - Date.parse(this.usage.windowStartedAt || this.createdAt); }
  windowExhausted(now = Date.now()) { return this.windowElapsedMs(now) >= this.budgets.wallClockMs; }
  itemsExhausted(count) { return count >= this.budgets.maxItems; }
  failuresExhausted(count) { return count >= this.budgets.maxFailures; }

  /** A resume opens a fresh budget window — every extension is recorded, never silent. */
  openBudgetWindow() {
    this.usage.budgetWindows += 1;
    this.usage.windowStartedAt = new Date().toISOString();
    this._persist();
    return this.usage.budgetWindows;
  }

  /* ── user controls (validated against the state machine) ──────────── */

  pause(reason = '') {
    this.pausedReason = String(reason || 'paused by user').slice(0, 300);
    this.setState('PAUSED', this.pausedReason);
    return this;
  }

  resume() {
    this.setState('EXECUTING', 'resume');
    this.pausedReason = null;
    this.needsQuestion = null;
    this.awaitingAnswerFor = null;
    this.openBudgetWindow('resume');
    return this;
  }

  cancel(reason = '') {
    if (this.isTerminal) return this;
    this.setState('CANCELLED', String(reason || 'cancelled by user').slice(0, 300));
    return this;
  }

  queueSteering(message) {
    // file-backed queue: a control/steer API call and the runner's in-flight
    // mission object must never clobber each other's state on mission.json
    const q = readSteeringQueue(this.id);
    q.push({ at: new Date().toISOString(), message: String(message || '').slice(0, 2000) });
    writeSteeringQueue(this.id, q.slice(-10));
    return this;
  }

  takeSteeringQueue() {
    const q = readSteeringQueue(this.id);
    writeSteeringQueue(this.id, []);
    return q;
  }

  /* ── event log (append-only, chained) ─────────────────────────────── */

  /**
   * Append a mission event. Events CHAIN (parentEventId) like task events and
   * persist immediately to events.jsonl — the replay source after reconnect.
   * NOTE: this deliberately does NOT rewrite mission.json — a long-lived
   * mission object (the runner holds one across an await) must never clobber
   * concurrent state changes made by control API calls on fresh objects.
   */
  appendEvent({ type, title = '', summary = '', data = {}, severity = 'info', parentEventId = undefined }) {
    const seq = Math.max(this.eventSeq || 0, __eventSeq.get(this.id) || 0) + 1;
    this.eventSeq = seq;
    __eventSeq.set(this.id, seq);
    const evt = {
      id: `mev-${this.id}-${String(seq).padStart(4, '0')}`,
      ts: new Date().toISOString(),
      parentEventId: parentEventId !== undefined ? parentEventId : this._lastEventId(),
      missionId: this.id,
      conversationId: this.conversationId,
      state: this.state,
      type: String(type || 'UNKNOWN').slice(0, 60),
      title: String(title || '').slice(0, 120),
      summary: String(summary || '').slice(0, 500),
      data: data && typeof data === 'object' ? data : {},
      severity: ['info', 'warn', 'error'].includes(severity) ? severity : 'info',
    };
    try {
      fs.mkdirSync(this._dir(), { recursive: true });
      fs.appendFileSync(path.join(this._dir(), 'events.jsonl'), JSON.stringify(evt) + '\n');
    } catch { /* best-effort; live subscribers still get it */ }
    return evt;
  }

  _lastEventId() {
    // NOTE: this.eventSeq is the id of the event being built RIGHT NOW — the
    // parent is the one before it (seq - 1), never itself.
    return this.eventSeq > 1 ? `mev-${this.id}-${String(this.eventSeq - 1).padStart(4, '0')}` : null;
  }

  /* ── persistence ──────────────────────────────────────────────────── */

  _dir() { return path.join(MISSIONS_DIR, this.id); }
  _file() { return path.join(this._dir(), 'mission.json'); }

  _persist() {
    try {
      fs.mkdirSync(this._dir(), { recursive: true });
      const tmp = `${this._file()}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this));
      fs.renameSync(tmp, this._file());
    } catch { /* best-effort */ }
  }
}

/* ── store functions ─────────────────────────────────────────────────── */

export function loadMission(missionId) {
  try {
    const safe = String(missionId).replace(/[^a-z0-9-]/gi, '_').slice(0, 80);
    const raw = JSON.parse(fs.readFileSync(path.join(MISSIONS_DIR, safe, 'mission.json'), 'utf-8'));
    // hydrate WITHOUT the constructor (it persists a fresh record — loading
    // must never write); prototype access keeps the state-machine methods.
    const m = Object.create(Mission.prototype);
    Object.assign(m, raw, { id: safe });
    // sync the event sequence from the append-only log (source of truth)
    const lastSeq = lastEventSeq(safe);
    __eventSeq.set(safe, Math.max(raw.eventSeq || 0, lastSeq, __eventSeq.get(safe) || 0));
    return m;
  } catch { return null; }
}

/** Last event sequence in a mission's append-only log (0 when empty). */
function lastEventSeq(safeId) {
  try {
    const lines = fs.readFileSync(path.join(MISSIONS_DIR, safeId, 'events.jsonl'), 'utf-8').split('\n').filter(Boolean);
    if (!lines.length) return 0;
    const last = JSON.parse(lines[lines.length - 1]);
    const m = String(last.id || '').match(/-(\d+)$/);
    return m ? Number(m[1]) : 0;
  } catch { return 0; }
}

/* File-backed steering queue (safe against cross-object clobbering). */
function readSteeringQueue(missionId) {
  try {
    const safe = String(missionId).replace(/[^a-z0-9-]/gi, '_').slice(0, 80);
    const q = JSON.parse(fs.readFileSync(path.join(MISSIONS_DIR, safe, 'steering.json'), 'utf-8'));
    return Array.isArray(q) ? q : [];
  } catch { return []; }
}
function writeSteeringQueue(missionId, queue) {
  try {
    const safe = String(missionId).replace(/[^a-z0-9-]/gi, '_').slice(0, 80);
    fs.mkdirSync(path.join(MISSIONS_DIR, safe), { recursive: true });
    const tmp = path.join(MISSIONS_DIR, safe, 'steering.json.tmp');
    fs.writeFileSync(tmp, JSON.stringify(queue));
    fs.renameSync(tmp, path.join(MISSIONS_DIR, safe, 'steering.json'));
  } catch { /* best-effort */ }
}

/** All missions (newest first), optionally filtered by conversation. */
export function listMissions(conversationId = null, limit = 100) {
  try {
    const ids = fs.readdirSync(MISSIONS_DIR).filter((d) => /^ms-/.test(d));
    const missions = [];
    for (const id of ids) {
      const m = loadMission(id);
      if (m && (!conversationId || m.conversationId === String(conversationId))) missions.push(m);
    }
    missions.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return missions.slice(0, limit);
  } catch { return []; }
}

/** The conversation's active/resumable mission (newest), if any. */
export function activeMissionFor(conversationId) {
  return listMissions(conversationId, 20).find((m) => m.isResumable) || null;
}

/** Mission events from the append-only log, optionally after an event id. */
export function loadMissionEvents(missionId, sinceEventId = '') {
  try {
    const safe = String(missionId).replace(/[^a-z0-9-]/gi, '_').slice(0, 80);
    const lines = fs.readFileSync(path.join(MISSIONS_DIR, safe, 'events.jsonl'), 'utf-8').split('\n').filter(Boolean);
    // bound the replay window (the log is append-only; keep the last 2000)
    const events = lines.slice(-2000).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    if (sinceEventId) {
      const i = events.findIndex((e) => e.id === sinceEventId);
      if (i >= 0) return events.slice(i + 1);
    }
    return events;
  } catch { return []; }
}

export function missionsDir() { return MISSIONS_DIR; }

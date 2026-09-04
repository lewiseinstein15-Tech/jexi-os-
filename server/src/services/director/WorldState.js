/**
 * B215 — WORLD STATE (spec Part 9): the explicit, persisted record of the
 * environment JEXI actually operates in, per mission (and a global runtime
 * snapshot), updated ONLY by real actions as they happen.
 *
 *   files      — what exists in the mission workspace (observed via the
 *                CommandRunner: every command that runs lists the workspace)
 *   processes  — every command executed (cmd, exit code, duration) — a real
 *                process record, not a guess
 *   browser    — last real browser state (available / last URL / blocked
 *                reason), from ComputerOps rounds
 *   repos      — workspace publishes (repo, slug, live URL, at)
 *   network    — last observed outcome of a real network operation
 *                (publish/search) — no synthetic pings
 *   runtime    — process facts (node version, command allowlist, browser
 *                availability flag) read from the REAL config, never probed
 *                into fake presence
 *
 * Where it lives: DATA_DIR/world/<ownerId>.json (atomic tmp+rename, the same
 * persistence family as missions) + DATA_DIR/world/_global.json. Owner is the
 * MISSION id when running under MissionRunner (task.workspaceId), else the
 * DirectorTask id (chat-lane turns).
 *
 * Honesty contract: an empty world state is reported empty ("no prior
 * environment activity recorded"). Nothing here is synthesized, inferred or
 * back-filled — if a subsystem didn't report, its section stays absent.
 */

import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../../config.js';

const WORLD_DIR = path.join(DATA_DIR, 'world');
const GLOBAL_ID = '_global';
const MAX_RECORDS = 200; // bounded: latest N per list (state, not an archive)

function fileFor(ownerId) {
  return path.join(WORLD_DIR, `${String(ownerId).replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);
}

function atomicWrite(file, data) {
  fs.mkdirSync(WORLD_DIR, { recursive: true });
  const tmp = `${file}.tmp-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1));
  fs.renameSync(tmp, file);
}

const now = () => new Date().toISOString();
const pushBounded = (list, entry, cap = MAX_RECORDS) => {
  list.push(entry);
  if (list.length > cap) list.splice(0, list.length - cap);
};

export class WorldState {
  constructor(ownerId) {
    this.ownerId = String(ownerId);
    this.state = { ownerId: this.ownerId, updatedAt: null, seq: 0, files: [], processes: [], browser: {}, repos: [], network: {} };
    this._load();
  }

  _load() {
    try {
      const raw = fs.readFileSync(fileFor(this.ownerId), 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && parsed.ownerId === this.ownerId) this.state = { ...this.state, ...parsed };
    } catch { /* no prior state — honest empty */ }
  }

  _persist() {
    this.state.updatedAt = now();
    this.state.seq = (this.state.seq || 0) + 1;
    try { atomicWrite(fileFor(this.ownerId), this.state); } catch { /* disk issues must never fail execution */ }
  }

  /** A real command ran in the mission workspace (from CommandRunner results). */
  recordCommand({ command, ok, exitCode, ms, timedOut, blocked, reason, workspaceFiles }) {
    pushBounded(this.state.processes, {
      at: now(), command: String(command || '').slice(0, 200),
      ok: Boolean(ok), exitCode: exitCode ?? null, ms: ms ?? null,
      timedOut: Boolean(timedOut), blocked: Boolean(blocked), reason: reason ? String(reason).slice(0, 120) : undefined,
    }, 60);
    if (Array.isArray(workspaceFiles)) {
      const seen = new Map((this.state.files || []).map((f) => [f.path, f]));
      for (const f of workspaceFiles) seen.set(f.path, { ...f, observedAt: now() });
      this.state.files = [...seen.values()].slice(-MAX_RECORDS);
    }
    this._persist();
    return this.state;
  }

  /** A real browser round happened (ComputerOps) — or is honestly unavailable. */
  recordBrowser({ available, url, title, action, ok, blockedReason }) {
    this.state.browser = {
      ...(this.state.browser || {}),
      updatedAt: now(),
      available: Boolean(available),
      ...(url !== undefined ? { lastUrl: String(url || '').slice(0, 300) } : {}),
      ...(title !== undefined ? { lastTitle: String(title || '').slice(0, 200) } : {}),
      ...(action !== undefined ? { lastAction: String(action || '').slice(0, 120) } : {}),
      ...(ok !== undefined ? { lastOk: Boolean(ok) } : {}),
      ...(blockedReason ? { blockedReason: String(blockedReason).slice(0, 200) } : {}),
    };
    this._persist();
    return this.state;
  }

  /** A real publish to the workspace repo happened. */
  recordPublish({ repo, slug, url, live }) {
    pushBounded(this.state.repos, {
      at: now(), repo: String(repo || ''), slug: String(slug || ''),
      url: String(url || '').slice(0, 300), live: Boolean(live),
    }, 40);
    this._persist();
    return this.state;
  }

  /** The observed outcome of a real network operation (publish/search). */
  recordNetwork({ ok, detail }) {
    this.state.network = { at: now(), ok: Boolean(ok), ...(detail ? { detail: String(detail).slice(0, 160) } : {}) };
    this._persist();
    return this.state;
  }

  snapshot() { return JSON.parse(JSON.stringify(this.state)); }

  /**
   * Compact planning context (spec: "do not operate on stale assumptions").
   * Only REAL entries appear; an untouched world says so honestly.
   */
  summaryBlock() {
    const s = this.state;
    if (!s.processes.length && !s.files.length && !s.repos.length && !s.browser.updatedAt) {
      return '# WORLD STATE\nNo prior environment activity recorded for this mission — start from the objective, not assumptions.';
    }
    const lines = ['# WORLD STATE (real, observed — not assumptions)'];
    if (s.files.length) lines.push(`Workspace files (${s.files.length}): ${s.files.slice(-12).map((f) => f.path).join(', ')}`);
    if (s.processes.length) {
      const last = s.processes[s.processes.length - 1];
      lines.push(`Commands executed: ${s.processes.length} (last: \`${last.command}\` → exit ${last.exitCode ?? '?'}${last.blocked ? ' blocked' : ''})`);
    }
    if (s.browser.updatedAt) {
      lines.push(`Browser: ${s.browser.available ? `available (last: ${s.browser.lastUrl || '—'})` : `unavailable${s.browser.blockedReason ? ` — ${s.browser.blockedReason}` : ''}`}`);
    }
    if (s.repos.length) {
      const last = s.repos[s.repos.length - 1];
      lines.push(`Published: ${s.repos.length} time(s) (last: ${last.slug}${last.live ? ' live' : ''})`);
    }
    if (s.network.at) lines.push(`Network (last real op): ${s.network.ok ? 'ok' : 'FAILED'} at ${s.network.at}`);
    return lines.join('\n');
  }
}

/* ── global runtime snapshot (process-wide facts, real config only) ─────── */

let __globalInstance = null;

/** Real runtime capabilities: what this process can ACTUALLY do. No probes that fake presence. */
export function runtimeCapabilities() {
  const noBrowser = String(process.env.JEXI_NO_BROWSER || '') === '1';
  return {
    node: process.version,
    dataDir: DATA_DIR,
    shell: {
      available: true, // CommandRunner runs in-process (allowlisted binaries)
      allowlist: ['node', 'node --test', 'python3', 'ls', 'cat', 'head', 'tail', 'wc', 'grep', 'echo', 'diff'],
      note: 'one plain command per block; no pipes/redirects (CommandRunner policy)',
    },
    python: { binary: 'python3', policy: 'allowlisted via CommandRunner' },
    browser: {
      available: !noBrowser,
      ...(noBrowser ? { reason: 'JEXI_NO_BROWSER=1 (slim image — no Chromium); computer use reports BLOCKED, never faked' } : {}),
    },
    workspacePublish: { repo: process.env.JEXI_WORKSPACE_REPO || 'lewiseinstein15-Tech/jexi-workspace' },
  };
}

/** The global world state (cross-mission: publishes, network observations). */
export function globalWorld() {
  if (!__globalInstance) __globalInstance = new WorldState(GLOBAL_ID);
  return __globalInstance;
}

export function loadWorldState(ownerId) {
  return new WorldState(ownerId);
}

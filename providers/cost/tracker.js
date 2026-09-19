/**
 * JEXI OS — Cost caps — per-session + per-provider spend ledger (Phase 9 E).
 *
 * DUMB ledger: it stores money and answers "how much". It knows NOTHING
 * about thresholds — that is caps.js. Keeping the two apart means the
 * threshold engine can be tested against any ledger shape and the ledger
 * can be persisted without trusting it to make decisions.
 *
 * Money is stored as INTEGER micro-US$ (1 USD = 1_000_000 µ$). Binary
 * floating point cannot accumulate money (0.1 + 0.2 !== 0.3): a session
 * that records $0.01 one hundred times MUST land exactly on $1.00 or the
 * hard cap fires late (or never). Integer micros make that impossible to
 * get wrong. USD appears only at the API boundary, rounded to 1e-6.
 *
 * Persistence is OPT-IN (persistPath): default is in-memory only, because
 * cost caps guard a LIVE session — the runtime opts into durability by
 * passing a path (or JEXI_COST_LEDGER_PATH for the module default).
 * Writes are atomic (tmp file + rename); a corrupt ledger REFUSES to load
 * (E_LEDGER_CORRUPT) instead of silently starting from zero — silently
 * wiping spend data would let a restart bypass the cap.
 *
 * Concurrency: single-writer per ledger file, per process. Multi-process
 * writers would need file locking — out of scope, documented in README.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';

export const MICROS_PER_USD = 1_000_000;
export const LEDGER_VERSION = 1;
export const MAX_ATTEMPTS = 50; // refused-record evidence is kept, bounded

export class LedgerError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'LedgerError';
    this.code = code;
  }
}

/** USD → integer micro-US$. Refuses negative/non-finite. Rounds to 1e-6. */
export function usdToMicros(usd) {
  const n = Number(usd);
  if (!Number.isFinite(n) || n < 0) {
    throw new LedgerError('E_INVALID_SPEND', `spend must be a finite non-negative USD number, got ${String(usd)}`);
  }
  return Math.round(n * MICROS_PER_USD);
}

/** Integer micro-US$ → USD number (exact to 1e-6). */
export function microsToUsd(micros) {
  return Math.round(micros) / MICROS_PER_USD;
}

function newEntry(sessionId, now) {
  return {
    sessionId,
    providers: {}, // providerId → micros
    totalMicros: 0,
    budgetMicros: null,
    warnFired: {}, // threshold (stringified) → iso timestamp of the ONE warning
    warnings: [], // [{ threshold, pct, at }] — append-only evidence
    capped: false,
    cappedAt: null,
    cappedReason: null,
    attempts: [], // refused records [{ at, providerId, usd, code, reason }]
    createdAt: now,
    updatedAt: now,
  };
}

export function createTracker({ persistPath = null } = {}) {
  const path = persistPath ? resolvePath(persistPath) : null;
  let sessions = null; // Map<sessionId, entry> — lazily loaded

  function ensureLoaded() {
    if (sessions) return;
    sessions = new Map();
    if (!path || !existsSync(path)) return;
    let raw;
    try {
      raw = JSON.parse(readFileSync(path, 'utf8'));
    } catch (e) {
      throw new LedgerError(
        'E_LEDGER_CORRUPT',
        `cost ledger ${path} is not valid JSON (${e.message}) — refusing to start with spend data missing; fix or remove the file`
      );
    }
    if (!raw || raw.version !== LEDGER_VERSION || typeof raw.sessions !== 'object' || raw.sessions === null) {
      throw new LedgerError(
        'E_LEDGER_CORRUPT',
        `cost ledger ${path} has unexpected shape (version=${raw && raw.version}) — refusing to guess`
      );
    }
    for (const [id, entry] of Object.entries(raw.sessions)) sessions.set(id, entry);
  }

  function save() {
    if (!path || !sessions) return;
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    const payload = {
      version: LEDGER_VERSION,
      savedAt: new Date().toISOString(),
      sessions: Object.fromEntries(sessions),
    };
    writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`);
    renameSync(tmp, path); // atomic on POSIX — a reader never sees a half-written ledger
  }

  function touch(entry) {
    entry.updatedAt = new Date().toISOString();
  }

  /** Materializes the session entry (creates an empty one when unknown). */
  function ensureSession(sessionId) {
    ensureLoaded();
    let entry = sessions.get(sessionId);
    if (!entry) {
      entry = newEntry(sessionId, new Date().toISOString());
      sessions.set(sessionId, entry);
    }
    return entry;
  }

  /** Read-only lookup — never materializes. Returns entry or null. */
  function getSession(sessionId) {
    ensureLoaded();
    return sessions.get(sessionId) ?? null;
  }

  function addSpend(sessionId, providerId, micros) {
    const entry = ensureSession(sessionId);
    entry.providers[providerId] = (entry.providers[providerId] ?? 0) + micros;
    entry.totalMicros += micros;
    touch(entry);
    save();
    return entry;
  }

  function setBudget(sessionId, micros) {
    const entry = ensureSession(sessionId);
    entry.budgetMicros = micros;
    touch(entry);
    save();
    return entry;
  }

  /** Generic mutation hook (warning events, cap flag) with persistence. */
  function mutate(sessionId, fn) {
    const entry = ensureSession(sessionId);
    fn(entry);
    touch(entry);
    save();
    return entry;
  }

  /** Keeps refused-record evidence WITHOUT adding spend. Bounded. */
  function noteAttempt(sessionId, attempt) {
    const entry = ensureSession(sessionId);
    entry.attempts.push(attempt);
    if (entry.attempts.length > MAX_ATTEMPTS) entry.attempts.splice(0, entry.attempts.length - MAX_ATTEMPTS);
    touch(entry);
    save();
    return entry;
  }

  function deleteSession(sessionId) {
    ensureLoaded();
    const existed = sessions.delete(sessionId);
    if (existed) save();
    return existed;
  }

  function clear() {
    ensureLoaded();
    const n = sessions.size;
    sessions.clear();
    if (n > 0) save();
    return n;
  }

  function listSessions() {
    ensureLoaded();
    return [...sessions.keys()];
  }

  return {
    ensureSession,
    getSession,
    addSpend,
    setBudget,
    mutate,
    noteAttempt,
    deleteSession,
    clear,
    listSessions,
    /** The resolved persistence path (null = in-memory). For probes/ops. */
    persistPathUsed: () => path,
  };
}

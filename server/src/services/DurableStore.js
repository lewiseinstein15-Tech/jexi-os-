/**
 * JEXI OS — DURABLE STORE (M10).
 *
 * A tiny, dependency-free JSON key/value store with crash-safe writes and
 * corruption-tolerant reads. It exists so per-session chat state (the parked
 * graph RunState, the resume offer, the last completed result) survives a
 * process restart — the exact gap M10 closes.
 *
 * Why not the SQLite workgraph engine (`src/workgraph`)? That engine persists
 * ONE graph snapshot per file and models mission nodes/leases, not the chat
 * RunState (intermediateResults, confirmationPayload, resumeNode). It is also
 * not wired into the chat path. Reusing its storage *pattern* (atomic JSON
 * under DATA_DIR, mirrored to Redis) is the smallest defensible change.
 *
 * Guarantees:
 *   - Writes are ATOMIC: write a temp file, fsync-free rename over the target.
 *     A crash mid-write can never leave a half-written record on disk.
 *   - Reads NEVER throw: a missing, unreadable or corrupt file returns
 *     `{ found:false }`; a corrupt file with a good `.bak` recovers from the
 *     backup and reports `corrupt:true` so the caller can be honest about it.
 *   - Keys are SANITIZED and hashed: two different logical keys can never
 *     collide on one file (isolation between sessions), and a key can never
 *     escape the store directory.
 *
 * Files live under DATA_DIR/sessions/<sanitized>-<hash>.json and are covered by
 * the Redis mirror (RedisMirror MIRRORED_DIRS), so they survive the free-tier
 * ephemeral disk the same way mission records do.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from '../config.js';

/** Process boot identity — a NEW value every process start. Used to tell an
 *  interrupted (in-flight) record from one parked across a restart. */
export const BOOT_EPOCH = `${Date.now().toString(36)}-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;

let __dirOverride = null; // test seam

/** Test seam: point the store at a temp dir (call __resetSessionsDir after). */
export function __setSessionsDir(dir) { __dirOverride = dir ? path.resolve(dir) : null; }
export function __resetSessionsDir() { __dirOverride = null; }
export function sessionsDir() { return __dirOverride || path.join(DATA_DIR, 'sessions'); }

/** Deterministic, collision-resistant, traversal-proof file stem for a key.
 *  The namespace (`run`, `offer`, `result`) is preserved as a filename prefix
 *  so a CORRUPT record can still be attributed to its logical kind even when
 *  its JSON (and thus its embedded key) is unreadable. */
export function keyStem(key) {
  const raw = String(key ?? '');
  const sep = raw.indexOf('::');
  const ns = (sep >= 0 ? raw.slice(0, sep) : 'k').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 24) || 'k';
  const body = (sep >= 0 ? raw.slice(sep + 2) : raw);
  const safe = body.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 96) || 'empty';
  const hash = crypto.createHash('sha1').update(raw).digest('hex').slice(0, 10);
  return `${ns}__${safe}--${hash}`;
}

/** Best-effort namespace + logical body recovered from a stem (corrupt case). */
export function parseStem(stem) {
  const s = String(stem || '').replace(/\.json$/, '');
  const i = s.indexOf('__');
  const j = s.lastIndexOf('--');
  const ns = i >= 0 ? s.slice(0, i) : 'k';
  const body = i >= 0 ? s.slice(i + 2, j >= 0 ? j : undefined) : s;
  return { ns, body };
}

/** Atomic write: temp file then rename. Never leaves a partial target. */
export function atomicWriteJson(file, value) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value));
  // Keep the previous good copy as .bak (best-effort) before overwriting.
  try { if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`); } catch { /* bak is best-effort */ }
  fs.renameSync(tmp, file); // atomic on POSIX
}

/**
 * Corruption-tolerant read.
 * @returns {{found:boolean, value:any, corrupt:boolean, recovered:boolean}}
 *   found     — a usable value was returned
 *   corrupt   — the primary file existed but was unreadable/unparseable
 *   recovered — the value came from the .bak fallback
 */
export function readJsonSafe(file) {
  const tryParse = (p) => {
    const raw = fs.readFileSync(p, 'utf-8');
    return JSON.parse(raw);
  };
  try {
    return { found: true, value: tryParse(file), corrupt: false, recovered: false };
  } catch {
    const existed = fs.existsSync(file);
    if (!existed) return { found: false, value: null, corrupt: false, recovered: false };
    // Primary exists but is bad — try the backup.
    try {
      const value = tryParse(`${file}.bak`);
      return { found: true, value, corrupt: true, recovered: true };
    } catch {
      return { found: false, value: null, corrupt: true, recovered: false };
    }
  }
}

/**
 * A durable, namespaced key/value store. All operations are SYNCHRONOUS to
 * match the existing SessionStore contract (no async ripple through index.js).
 */
export class DurableStore {
  constructor({ dir = null } = {}) {
    this._dirOverride = dir;
  }

  _dir() { return this._dirOverride || sessionsDir(); }
  _file(key) { return path.join(this._dir(), `${keyStem(key)}.json`); }

  /** Persist `value` under `key` (atomic). Returns the file path.
   *  The canonical logical `key` is stamped into the record as `__key` so
   *  `keys()` can enumerate real keys; `load()` strips it back out. */
  save(key, value) {
    const file = this._file(key);
    const record = (value && typeof value === 'object' && !Array.isArray(value))
      ? { ...value, __key: key }
      : { __key: key, value };
    atomicWriteJson(file, record);
    return file;
  }

  /** Load `value` for `key`. Never throws. `__key` is stripped from the result. */
  load(key) {
    const res = readJsonSafe(this._file(key));
    if (res.found && res.value && typeof res.value === 'object') {
      const { __key, ...rest } = res.value;
      return { ...res, value: rest };
    }
    return res;
  }

  /** Remove the record (and its .bak). */
  remove(key) {
    for (const f of [this._file(key), `${this._file(key)}.bak`]) {
      try { fs.rmSync(f, { force: true }); } catch { /* already gone */ }
    }
  }

  /** Logical keys currently persisted, INCLUDING corrupt slots (recovered from
   *  the filename namespace + body so a bad record is still attributed). */
  keys() {
    let files = [];
    try { files = fs.readdirSync(this._dir()); } catch { return []; }
    const out = [];
    for (const f of files) {
      if (!f.endsWith('.json') || f.endsWith('.bak')) continue;
      const res = readJsonSafe(path.join(this._dir(), f));
      if (res.found && res.value && typeof res.value === 'object' && typeof res.value.__key === 'string') {
        out.push(res.value.__key);
      } else {
        const { ns, body } = parseStem(f);
        out.push(`${ns}::${body}`);
      }
    }
    return out;
  }

  /** Wipe the store directory. */
  clear() {
    try { fs.rmSync(this._dir(), { recursive: true, force: true }); } catch { /* nothing to clear */ }
  }
}

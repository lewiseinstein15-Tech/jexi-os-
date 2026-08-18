/**
 * B134 — CREDENTIAL STORE (DeepSeek Harness
 * `packages/credentials/credentials-local` mirror).
 *
 * A managed credential store: keys written here override the process
 * environment (DSH precedence), are validated (POSIX-identifier names,
 * non-empty string values), stored with 0600 perms in DATA_DIR/credentials.json,
 * and deleted keys fall back to the environment. Everything below env /
 * the managed store is the fallback order (DSH: managed store wins).
 */

import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../config.js';
import { writeFileAtomic } from './AtomicWrite.js';

const CREDENTIALS_FILE = path.join(DATA_DIR, 'credentials.json');
const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

let cache = null;

function load() {
  if (cache) return cache;
  try { cache = JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf-8')); } catch { cache = {}; }
  if (!cache || typeof cache !== 'object') cache = {};
  return cache;
}

function save() {
  try {
    writeFileAtomic(CREDENTIALS_FILE, JSON.stringify(cache, null, 2));
    try { fs.chmodSync(CREDENTIALS_FILE, 0o600); } catch { /* best-effort */ }
  } catch { /* noop */ }
}

/** Validate a credential key + value (DSH rules). */
export function validateCredential(key, value) {
  if (!KEY_RE.test(String(key || ''))) return { ok: false, error: `invalid credential key "${key}" — must be a POSIX identifier (letters, digits, underscore)` };
  if (typeof value !== 'string' || value.length === 0) return { ok: false, error: 'credential value must be a non-empty string' };
  return { ok: true };
}

/** Resolve a credential: managed store first, then the environment (DSH precedence). */
export function resolveCredential(key) {
  const store = load();
  if (Object.prototype.hasOwnProperty.call(store, key)) return store[key];
  return process.env[key] || null;
}

/** Store a credential (managed store wins over env). */
export function setCredential(key, value) {
  const v = validateCredential(key, value);
  if (!v.ok) return v;
  load()[String(key)] = String(value);
  save();
  return { ok: true, key: String(key), source: 'managed' };
}

/** Delete a credential (falls back to the environment). */
export function deleteCredential(key) {
  if (load()[String(key)] !== undefined) {
    delete load()[String(key)];
    save();
  }
  return { ok: true, key: String(key), deleted: true };
}

/** List credential KEYS only (never values). */
export function listCredentialKeys() {
  return Object.keys(load());
}

/** True when a key exists in the managed store. */
export function hasManagedCredential(key) {
  return Object.prototype.hasOwnProperty.call(load(), String(key));
}

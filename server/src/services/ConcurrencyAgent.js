/**
 * JEXI OS — Concurrency Agent.
 *
 * Multi-user / multi-workspace isolation: named locks with TTL so concurrent
 * sessions never write the same memory, plus a stable workspace/session id
 * derived per request so memory is scoped per session. In-memory lock table
 * (Redis-backed locking is the production target when REDIS_URL is set —
 * the interface is identical).
 */

import crypto from 'crypto';

const locks = new Map(); // name -> { owner, acquiredAt, ttlMs }
const DEFAULT_TTL_MS = 30_000;

/** Acquire a named lock. Returns { ok, owner, lockId }. */
export function acquireLock(name, opts = {}) {
  const key = String(name || 'default');
  const ttlMs = Number(opts.ttlMs) || DEFAULT_TTL_MS;
  const now = Date.now();
  const existing = locks.get(key);
  // Expired locks are stealable (crash-safe: TTL means a dead holder can't block forever).
  if (existing && now - existing.acquiredAt < existing.ttlMs) {
    return { ok: false, locked: true, owner: existing.owner, error: `lock '${key}' held by ${existing.owner}` };
  }
  const owner = String(opts.owner || `session-${Math.random().toString(36).slice(2, 8)}`);
  const lockId = crypto.randomBytes(6).toString('hex');
  locks.set(key, { owner, acquiredAt: now, ttlMs, lockId });
  return { ok: true, key, owner, lockId };
}

/** Release a named lock (only the owning session may release it). */
export function releaseLock(name, opts = {}) {
  const key = String(name || 'default');
  const existing = locks.get(key);
  if (!existing) return { ok: true, alreadyFree: true, key };
  if (opts.owner && existing.owner !== String(opts.owner)) {
    return { ok: false, error: `lock '${key}' is held by ${existing.owner}, not ${opts.owner}` };
  }
  locks.delete(key);
  return { ok: true, released: true, key };
}

/** Force-release a lock (admin / cleanup path). */
export function forceReleaseLock(name) {
  locks.delete(String(name || 'default'));
  return { ok: true, key: String(name || 'default') };
}

/** Stable, deterministic workspace id from a session key (isolation). */
export function getWorkspaceId(sessionKey = '') {
  const seed = String(sessionKey || '').trim() || 'default';
  const hash = crypto.createHash('sha1').update(`jexi-ws:${seed}`).digest('hex').slice(0, 12);
  return { workspaceId: hash, sessionKey: seed };
}

/** All held locks (names + owners only — metadata, no payloads). */
export function listLocks() {
  const now = Date.now();
  return [...locks.entries()]
    .filter(([, l]) => now - l.acquiredAt < l.ttlMs)
    .map(([key, l]) => ({ key, owner: l.owner, remainingMs: l.ttlMs - (now - l.acquiredAt) }));
}

/** Scope a memory key to a workspace so sessions never bleed into each other. */
export function scopeMemoryKey(baseKey, workspaceId) {
  return `${workspaceId}:${String(baseKey || '').replace(/^[^:]+:/, '')}`;
}

/**
 * JEXI OS — Redis Store (shared persistence mirror).
 *
 * A tiny, safe wrapper around ioredis for modules that must survive
 * redeploys on ephemeral-disk hosts (Render free, HF Spaces without a
 * volume): memory already does this via MemoryManager's own client; this
 * gives schedules + goal jobs the same capability.
 *
 * Every call is bounded (5s), lazy (no connection until REDIS_URL exists),
 * and fail-open (Redis down → null / no-op — never blocks or throws into
 * the caller's flow).
 */

import Redis from 'ioredis';

const TIMEOUT_MS = 5000;
let client = null;

export function isRedisConfigured() {
  return Boolean(process.env.REDIS_URL);
}

export function getRedis() {
  if (client) return client;
  if (!isRedisConfigured()) return null;
  try {
    // Auto-connect on construction (NOT lazyConnect): with lazyConnect +
    // enableOfflineQueue:false, commands issued before the async connect
    // resolves are rejected immediately — which made early hydrations
    // silently fail. Auto-connect + default offline queue lets early calls
    // wait for the connection; every call is still bounded by withTimeout.
    client = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      connectTimeout: 4000,
    });
    client.on('error', () => { /* fail open — never throw into callers */ });
    return client;
  } catch {
    return null;
  }
}

function withTimeout(promise) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Redis timeout')), TIMEOUT_MS)),
  ]);
}

/** Read a key; null when unset / Redis unavailable / error. Never throws. */
export async function redisGet(key) {
  try {
    const r = getRedis();
    if (!r) return null;
    const val = await withTimeout(r.get(key));
    return val == null ? null : String(val);
  } catch {
    return null;
  }
}

/** Write a key (fire-and-forget semantics but bounded). Never throws. */
export async function redisSet(key, value) {
  try {
    const r = getRedis();
    if (!r) return;
    await withTimeout(r.set(key, String(value)));
  } catch {
    /* fail open */
  }
}

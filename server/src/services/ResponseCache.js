/**
 * JEXI OS — RESPONSE CACHE (AGI Phase 1, increment 3).
 *
 * Safe caching (spec §15): identical, cacheable requests get their stored
 * answer instead of another model call. Rules that keep it honest:
 *
 *   - OPT-IN per call: a response is stored only when the caller marked it
 *     cacheable (opts.cache === true). Anything that must be fresh (time
 *     context, search results, tool state, personalization) simply isn't
 *     marked cacheable.
 *   - TTL + max entries: entries expire; the cache can't grow forever.
 *   - Explicit invalidation: by key prefix or wholesale.
 *   - Never caches failures, never caches streaming-only responses,
 *     records hit/miss stats for the dashboard.
 */

const MAX_ENTRIES = 200;
const DEFAULT_TTL_MS = 30 * 60_000; // 30 minutes

const store = new Map(); // key → { value, at, expiresAt, meta }
const stats = { hits: 0, misses: 0, stores: 0, evictions: 0 };

/** Stable cache key from the parts that determine the answer. */
export function cacheKey({ prompt = '', system = '', provider = null, model = null, temperature = null, namespace = 'llm' }) {
  const parts = [namespace, provider || '*', model || '*', temperature == null ? '*' : temperature, String(prompt), String(system)];
  let h = 5381;
  const s = parts.join('\u0001');
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `${namespace}:${(h >>> 0).toString(36)}`;
}

export function cacheGet(key, now = Date.now()) {
  const e = store.get(key);
  if (!e) { stats.misses += 1; return null; }
  if (now >= e.expiresAt) { store.delete(key); stats.evictions += 1; stats.misses += 1; return null; }
  stats.hits += 1;
  return e;
}

export function cacheSet(key, value, { ttlMs = DEFAULT_TTL_MS, meta = {}, now = Date.now() } = {}) {
  if (value == null) return false;
  // bound the cache: evict the oldest entry when full
  if (store.size >= MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    store.delete(oldest);
    stats.evictions += 1;
  }
  store.set(key, { value, at: now, expiresAt: now + ttlMs, meta });
  stats.stores += 1;
  return true;
}

/** Invalidate by namespace (or exactly). Returns entries removed. */
export function cacheInvalidate(prefixOrKey) {
  let n = 0;
  if (!prefixOrKey) { n = store.size; store.clear(); return n; }
  const p = String(prefixOrKey);
  if (store.has(p)) { store.delete(p); return 1; }
  for (const k of [...store.keys()]) if (k.startsWith(p)) { store.delete(k); n += 1; }
  return n;
}

export function cacheStats() { return { ...stats, entries: store.size, maxEntries: MAX_ENTRIES }; }

/** Test seam. */
export function __resetCache() { store.clear(); stats.hits = stats.misses = stats.stores = stats.evictions = 0; }

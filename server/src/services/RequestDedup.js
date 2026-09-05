/**
 * JEXI OS — REQUEST DEDUPLICATION (AGI Phase 1, increment 4).
 *
 * If several agents ask essentially the same thing at the same time
 * (spec §16), they share ONE in-flight request instead of firing N identical
 * model calls. Safety rules:
 *
 *   - Only applies to calls without streaming callbacks (deltas can't be
 *     fairly fanned out to multiple consumers).
 *   - Only concurrent requests are shared: once the shared call resolves,
 *     the next identical request is a fresh one (no staleness).
 *   - Failed shared requests reject for EVERYONE — and are never kept
 *     in-flight after rejection.
 */

const inflight = new Map(); // key → Promise
const stats = { coalesced: 0, unique: 0 };

/**
 * Run `fn` once for all concurrent callers with the same key.
 * @param {string} key — canonical request identity
 * @param {() => Promise} fn
 */
export function dedupeInflight(key, fn) {
  const existing = inflight.get(key);
  if (existing) {
    stats.coalesced += 1;
    return existing;
  }
  stats.unique += 1;
  const p = Promise.resolve()
    .then(() => fn())
    .finally(() => { inflight.delete(key); });
  inflight.set(key, p);
  return p;
}

/** Canonical identity of a generateContent call, callbacks excluded. */
export function requestIdentity({ prompt = '', system = '', imageBase64 = null, provider = null, model = null, temperature = null }) {
  // content hash (djb2) over the parts that determine the answer — length
  // alone would collide different prompts of the same size
  const mat = `${String(prompt)}\u0001${String(system)}\u0001${imageBase64 ? String(imageBase64).slice(0, 4096) : ''}`;
  let h = 5381;
  for (let i = 0; i < mat.length; i++) h = ((h << 5) + h + mat.charCodeAt(i)) | 0;
  return ['genv2', provider || '*', model || '*', temperature == null ? '*' : temperature, (h >>> 0).toString(36), imageBase64 ? 'img' : 'noimg'].join('|');
}

export function dedupStats() { return { ...stats, inFlight: inflight.size }; }

/** Test seam. */
export function __resetDedup() { stats.coalesced = 0; stats.unique = 0; }

/**
 * JEXI OS — Phase 28 Scope D — hybrid retrieval: reciprocal rank fusion.
 *
 * REAL RRF (Cormack et al.): score(d) = Σ_lists 1 / (K + rank(d)) with
 * K = 60 (declared, matches gbrain). Rank is 1-based within each list; a
 * chunk absent from a list contributes nothing. Fully auditable: every
 * contribution (list name, rank, term) is recorded per chunk.
 */
export const RRF_K = 60;

/**
 * rrfFuse(lists) -> { fused: [{ chunkId, score, contributions }], byChunk }
 * lists: [{ name, ranked: [{ chunkId }] }]
 */
export function rrfFuse(lists) {
  const byChunk = new Map();
  for (const list of lists) {
    list.ranked.forEach((item, i) => {
      const rank = i + 1;
      const term = 1 / (RRF_K + rank);
      const rec = byChunk.get(item.chunkId) || { chunkId: item.chunkId, score: 0, contributions: [] };
      rec.score += term;
      rec.contributions.push({ list: list.name, rank, term });
      byChunk.set(item.chunkId, rec);
    });
  }
  const fused = [...byChunk.values()];
  fused.sort((a, b) => (b.score - a.score) || (a.chunkId < b.chunkId ? -1 : 1));
  return { fused, byChunk };
}

/** Min-max normalize to [0,1] (max -> 1); preserves ties; deterministic. */
export function normalize(scores) {
  const vals = [...scores.values()];
  if (vals.length === 0) return new Map();
  const max = Math.max(...vals);
  const min = Math.min(...vals);
  const span = max - min;
  const out = new Map();
  for (const [k, v] of scores) out.set(k, span === 0 ? 1 : (v - min) / span);
  return out;
}

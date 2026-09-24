/**
 * JEXI OS — Phase 28 Scope D — hybrid retrieval: vector (cosine) leg.
 *
 * Consumes Scope B's public API: the query is embedded through index.embed()
 * with NO opts — that is the index's OWN resolved backend (rule-based or
 * provider), never a silent downgrade — and scored by REAL cosine against the
 * stored vectors. Deterministic (ties by chunkId asc).
 */
import { cosine } from '../index/index.js';

/**
 * vectorRank(query, index) -> { ranked: [{ chunkId, score }], cosineByChunk }
 * ranked desc by cosine; cosineByChunk feeds the 0.7/0.3 re-score blend.
 */
export async function vectorRank(query, index) {
  const { vectors } = await index.embed([{ chunkId: '__query__', text: query }]);
  const snap = index.store.snapshot();
  const qv = vectors[0].vector;
  const ranked = snap.records.map((r) => ({ chunkId: r.chunkId, score: cosine(qv, r.vector) }));
  ranked.sort((a, b) => (b.score - a.score) || (a.chunkId < b.chunkId ? -1 : 1));
  const cosineByChunk = new Map(ranked.map((r) => [r.chunkId, r.score]));
  return { ranked, cosineByChunk, queryVector: qv };
}

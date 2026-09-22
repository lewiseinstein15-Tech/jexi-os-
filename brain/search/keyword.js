/**
 * JEXI OS — Phase 28 Scope D — hybrid retrieval: keyword (BM25) leg.
 *
 * Read-only consumption of Phase 19 B: the SAME tokenizer + BM25 (k1=1.5,
 * b=0.75) from surfsense's public API, applied to brain chunks. Deterministic
 * (ties by chunkId asc, Phase 19 shape).
 */
import { bm25Scores, K1, B } from '../../surfsense/search/keyword.js';

/**
 * keywordRank(query, chunks) -> ranked[] = [{ chunkId, score }] desc.
 * chunks: [{ chunkId, text }] (Scope B chunk shape).
 */
export function keywordRank(query, chunks) {
  const docs = chunks.map((c) => ({ id: c.chunkId, text: c.text }));
  const scores = bm25Scores(query, docs);
  // Zero-score documents are not lexical candidates. Keeping them would give
  // non-matches a synthetic RRF contribution determined only by chunkId.
  const out = chunks
    .map((c) => ({ chunkId: c.chunkId, score: scores.get(c.chunkId) || 0 }))
    .filter((c) => c.score > 0);
  out.sort((a, b) => (b.score - a.score) || (a.chunkId < b.chunkId ? -1 : 1));
  return out;
}

export { K1, B };

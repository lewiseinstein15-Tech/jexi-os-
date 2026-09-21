/**
 * JEXI OS — Phase 19 Scope B — surfsense/search entry point.
 *
 * Contract:
 *   search.keyword(query, docs)             -> ranked[]  (real BM25)
 *   search.vector(query, docs)              -> ranked[]  (rule-based cosine —
 *                                             "rule-based — embedding model NOT VERIFIED")
 *   search.hybrid(query, docs, { weights }) -> ranked[]  (weighted combination;
 *                                             optional graph boost via a
 *                                             capability/rag GraphRag instance)
 *
 * ranked[] entries are the input docs (spread) plus score fields, ordered
 * score-descending with deterministic id-ascending tiebreak. Determinism is
 * owned here — callers must not re-sort.
 *
 * Errors (SurfError, reused from surfsense/connectors/_internal.js):
 *   E_INVALID_DOC      — unknown document shape / duplicate ids
 *   E_INVALID_QUERY    — empty or non-string query
 *   E_INVALID_WEIGHTS  — invalid weights / boostStrength
 *   E_INVALID_GRAPH    — graph object without a query() function
 */
import { keyword, bm25Scores, validateDocs, validateQuery, normalizeScores, K1, B } from './keyword.js';
import { vector, VECTOR_LABEL } from './vector.js';
import { hybrid, validateWeights, GRAPH_AVAILABLE, GRAPH_LABEL } from './hybrid.js';

export {
  keyword,
  vector,
  hybrid,
  bm25Scores,
  validateDocs,
  validateQuery,
  validateWeights,
  normalizeScores,
  K1,
  B,
  VECTOR_LABEL,
  GRAPH_AVAILABLE,
  GRAPH_LABEL,
};

export default { keyword, vector, hybrid, VECTOR_LABEL, GRAPH_AVAILABLE, GRAPH_LABEL, K1, B };

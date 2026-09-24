/**
 * JEXI OS — Phase 19 Scope B — hybrid ranking (vector + keyword [+ graph]).
 *
 * SurfSense research note: SurfSense hybridizes retrieval across BM25 and
 * embedding similarity and pulls in LightRAG so a knowledge graph can
 * contribute to relevance. This module mirrors that shape with the pieces
 * that exist in this repo:
 *   - keyword score : real BM25               (./keyword.js)
 *   - vector score  : rule-based cosine over token sets — "rule-based —
 *                     embedding model NOT VERIFIED" (./vector.js)
 *   - graph boost   : OPTIONAL, via capability/rag/graph-rag.js (Phase 22 C,
 *                     LightRAG pattern). If the module is importable and the
 *                     caller passes a graph (a GraphRag instance or anything
 *                     with query()), the per-document graph score is
 *                     normalized and applied as a multiplicative boost:
 *                       final = combined * (1 + boostStrength * graphNorm)
 *                     If the capability is absent, the boost is skipped and
 *                     the probe reports it — this module never fails on its
 *                     absence.
 *
 * Hybrid score: weights must be non-negative finite numbers; they are
 * normalized to sum to 1 (defaults { keyword: 0.5, vector: 0.5 }). Component
 * scores are per-query normalized into [0, 1] before combining.
 *
 * Determinism: pure function of (query, docs, opts, graph). Ties broken by
 * document id ascending. Determinism is owned by the search modules — callers
 * must not re-sort.
 */
import { SurfError } from '../connectors/_internal.js';
import { validateDocs, validateQuery, bm25Scores, normalizeScores, byScoreThenId } from './keyword.js';
import { vector as vectorSearch, VECTOR_LABEL } from './vector.js';

export { VECTOR_LABEL };

// Optional capability/rag integration (Phase 22 C). Resolved once at module
// load; absence is a normal, reported condition — not an error.
let graphRagModule = null;
try {
  graphRagModule = await import('../../../capabilities/graph/rag/graph-rag.js');
} catch {
  graphRagModule = null;
}
export const GRAPH_AVAILABLE = graphRagModule !== null;
export const GRAPH_LABEL = GRAPH_AVAILABLE
  ? 'capability/rag/graph-rag available (Phase 22 C, LightRAG pattern, rule-based extraction)'
  : 'capability/rag/graph-rag not importable — graph boost skipped';

const DEFAULT_WEIGHTS = { keyword: 0.5, vector: 0.5 };

/**
 * Validate + normalize weights. Accepts { keyword, vector } with finite
 * non-negative numbers summing > 0; returns weights that sum to exactly 1.
 * Anything else -> E_INVALID_WEIGHTS. boostStrength (when provided) must be
 * a finite non-negative number.
 */
export function validateWeights(weights, boostStrength) {
  if (weights === undefined) weights = DEFAULT_WEIGHTS;
  if (weights === null || typeof weights !== 'object' || Array.isArray(weights)) {
    throw new SurfError('E_INVALID_WEIGHTS', 'weights must be an object { keyword, vector }');
  }
  const keys = Object.keys(weights).sort();
  if (keys.length !== 2 || keys[0] !== 'keyword' || keys[1] !== 'vector') {
    throw new SurfError(
      'E_INVALID_WEIGHTS',
      `weights must have exactly the keys "keyword" and "vector", received [${keys.join(', ')}]`
    );
  }
  for (const key of keys) {
    const v = weights[key];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
      throw new SurfError('E_INVALID_WEIGHTS', `weights.${key} must be a finite non-negative number, received ${v}`);
    }
  }
  const sum = weights.keyword + weights.vector;
  if (sum <= 0) {
    throw new SurfError('E_INVALID_WEIGHTS', 'weights.keyword + weights.vector must be > 0');
  }
  if (boostStrength !== undefined) {
    if (typeof boostStrength !== 'number' || !Number.isFinite(boostStrength) || boostStrength < 0) {
      throw new SurfError('E_INVALID_WEIGHTS', `boostStrength must be a finite non-negative number, received ${boostStrength}`);
    }
  }
  return { keyword: weights.keyword / sum, vector: weights.vector / sum };
}

/** Duck-type a graph: anything with a query(question, opts) function. */
function assertGraph(graph) {
  if (graph === null || typeof graph !== 'object' || typeof graph.query !== 'function') {
    throw new SurfError(
      'E_INVALID_GRAPH',
      'graph must be an object with query(question, opts) — e.g. a capability/rag GraphRag instance'
    );
  }
  return graph;
}

/**
 * search.hybrid(query, docs, { weights, graph, boostStrength }) -> ranked[]
 *
 * ranked[] = docs (spread) with:
 *   keywordScore — per-query normalized BM25 in [0, 1]
 *   vectorScore  — per-query normalized rule-based cosine in [0, 1]
 *   score        — final hybrid score (boost applied when graph given)
 *   graphScore   — present ONLY when a graph boost was applied
 */
export function hybrid(query, docs, opts = {}) {
  validateQuery(query);
  validateDocs(docs);
  const { weights: rawWeights, graph, boostStrength } = opts;
  const weights = validateWeights(rawWeights, boostStrength);

  const kw = normalizeScores(bm25Scores(query, docs));
  const vec = normalizeScores(
    new Map(vectorSearch(query, docs).map((entry) => [entry.id, entry.score]))
  );

  let graphScores = null;
  if (graph !== undefined) {
    assertGraph(graph);
    const gr = graph.query(query, { topK: docs.length, depth: 2, requireTraversal: false });
    graphScores = normalizeScores(new Map(gr.results.map((r) => [r.docId, r.score])));
  }
  const boost = boostStrength ?? 0.25;

  return docs
    .map((doc) => {
      const k = kw.get(doc.id) ?? 0;
      const v = vec.get(doc.id) ?? 0;
      const combined = weights.keyword * k + weights.vector * v;
      const entry = { ...doc, keywordScore: k, vectorScore: v, score: combined };
      if (graphScores) {
        const g = graphScores.get(doc.id) ?? 0;
        entry.graphScore = g;
        entry.score = combined * (1 + boost * g);
      }
      return entry;
    })
    .sort(byScoreThenId((entry) => entry.score));
}

export default { hybrid, validateWeights, GRAPH_AVAILABLE, GRAPH_LABEL };

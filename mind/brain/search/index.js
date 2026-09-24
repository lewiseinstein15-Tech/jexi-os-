/**
 * JEXI OS — Phase 28 Scope D — hybrid retrieval: public surface.
 *
 *   import { createHybridSearch } from '../brain/search/index.js';
 *   const search = createHybridSearch({ index, repo, edges, recency, tiersByPage, now });
 *   const { results, budgetUsed, droppedCount } = await search.hybrid(q, { topK, budgetTokens });
 *
 * results[] = { pageId, chunkId, score, reasons[] } — reasons is the
 * per-stage audit list (never collapsed to a string).
 */
export { createHybridSearch, COSINE_BLEND, estimateTokens } from './hybrid.js';
export { keywordRank } from './keyword.js';
export { vectorRank } from './vector.js';
export { rrfFuse, normalize, RRF_K } from './rrf.js';
export {
  applyCompiledTruthBoost, applyGraphSignals, applySourceTier,
  COMPILED_TRUTH_BOOST, ADJACENCY_HUB_BOOST, CROSS_SOURCE_HUB_BOOST, SOURCE_TIER_FACTORS,
} from './boosts.js';
export { applyRecency, decayFactor, matchPrefix, DEFAULT_RECENCY } from './recency-decay.js';
export { applyMMRLite, MMR_LITE_DEMOTE, clusterKey } from './mmr.js';
export { dedup } from './dedup.js';

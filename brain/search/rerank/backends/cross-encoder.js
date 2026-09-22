/**
 * JEXI OS — Phase 28 Scope E — injected external cross-encoder backend.
 *
 * Default model follows the researched gateway recipe:
 *   zeroentropyai:zerank-2
 *
 * Provider seam (NO network client imported here):
 *   { name, rerank({ query, documents, model, top_n }) -> Promise<response> }
 * `rank` is accepted as an alias for self-hosted llama.cpp adapters.
 * Response may be `rows[]` or `{ results: rows[] }`, where each row is
 * `{ index, relevance_score }` (zerank shape) or `{ index, relevanceScore }`.
 */
import { SemanticaError } from '../../../../semantica/_internal.js';
import { resultText } from '../interface.js';

export const NAME = 'cross-encoder';
export const DEFAULT_CROSS_ENCODER_MODEL = 'zeroentropyai:zerank-2';

export function isProviderAvailable(provider) {
  if (!provider || typeof provider !== 'object') return false;
  if (typeof provider.name !== 'string' || provider.name === '') return false;
  if (typeof provider.rerank !== 'function' && typeof provider.rank !== 'function') return false;
  if (typeof provider.available === 'function') return provider.available() === true;
  if (provider.available === false) return false;
  return true;
}

function normalizedRows(response) {
  const rows = Array.isArray(response) ? response : response?.results;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new SemanticaError('E_BACKEND_CONTRACT', 'cross-encoder returned an empty or malformed result set');
  }
  return rows.map((row, position) => {
    const score = row?.relevance_score ?? row?.relevanceScore ?? row?.score;
    if (!Number.isInteger(row?.index) || !Number.isFinite(score)) {
      throw new SemanticaError('E_BACKEND_CONTRACT',
        `cross-encoder result ${position} must carry integer index + numeric relevance score`);
    }
    return { index: row.index, score };
  });
}

export function createCrossEncoderBackend({ provider, model = DEFAULT_CROSS_ENCODER_MODEL } = {}) {
  return {
    name: `${NAME}:${model}`,
    available: () => isProviderAvailable(provider),
    async rank(query, results) {
      if (!isProviderAvailable(provider)) {
        throw new SemanticaError('E_PROVIDER_UNAVAILABLE',
          'no reranker provider configured; refusing to fake cross-encoder output');
      }
      const call = typeof provider.rerank === 'function' ? provider.rerank : provider.rank;
      const response = await call.call(provider, {
        query,
        documents: results.map(resultText),
        model,
        top_n: results.length,
      });
      const rows = normalizedRows(response)
        .filter((row) => row.index >= 0 && row.index < results.length)
        .sort((a, b) => (b.score - a.score) || (a.index - b.index));
      if (rows.length === 0) {
        throw new SemanticaError('E_BACKEND_CONTRACT', 'cross-encoder returned no valid result indices');
      }

      const seen = new Set();
      const ordered = [];
      for (const row of rows) {
        if (seen.has(row.index)) continue;
        seen.add(row.index);
        ordered.push(results[row.index]);
      }
      // A partial provider response must never silently delete recall.
      for (let index = 0; index < results.length; index += 1) {
        if (!seen.has(index)) ordered.push(results[index]);
      }
      return ordered;
    },
  };
}

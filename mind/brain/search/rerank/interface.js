/**
 * JEXI OS — Phase 28 Scope E — reranker contract.
 *
 * A backend is an injected object:
 *   { name, available() -> boolean, rank(query, results, context) -> Promise<results[]> }
 * No backend is allowed to fabricate scores. The default backend is noop.
 */
import { SemanticaError } from '../../../semantica/_internal.js';

export const DEFAULT_RERANK_TOP_K = 20;
export const TOKENMAX_MODE = 'tokenmax';

export function rerankEnabled(mode) {
  return mode === TOKENMAX_MODE;
}

export function assertRankInput(query, results, topK) {
  if (typeof query !== 'string' || query.trim() === '') {
    throw new SemanticaError('E_INVALID_QUERY', 'rerank query must be a non-empty string');
  }
  if (!Array.isArray(results)) {
    throw new SemanticaError('E_INVALID_ARGUMENT', 'rerank results must be an array');
  }
  if (!Number.isInteger(topK) || topK < 0) {
    throw new SemanticaError('E_INVALID_ARGUMENT', `rerank topK must be a non-negative integer, got ${JSON.stringify(topK)}`);
  }
  return results;
}

export function assertBackend(backend) {
  if (!backend || typeof backend !== 'object' || typeof backend.name !== 'string' ||
      typeof backend.available !== 'function' || typeof backend.rank !== 'function') {
    throw new SemanticaError('E_BACKEND_CONTRACT',
      'reranker backend must be { name, available(), rank(query, results, context) }');
  }
  return backend;
}

/** Text sent to a cross-encoder; mirrors gbrain's defensive fallbacks. */
export function resultText(result) {
  if (!result || typeof result !== 'object') return '';
  for (const key of ['text', 'chunk_text', 'content', 'title']) {
    if (typeof result[key] === 'string') return result[key];
  }
  return '';
}

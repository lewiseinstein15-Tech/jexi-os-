/**
 * JEXI OS — Phase 28 Scope E — per-call reranker token budget.
 *
 * Cross-encoders score query/document pairs, so the query cost is counted once
 * per document: required = N*queryTokens + sum(documentTokens). The estimator
 * is dependency-free and deterministic: ceil(UTF-16 chars / 4), matching the
 * declared Scope D token heuristic.
 */
import { SemanticaError } from '../../../semantica/_internal.js';
import { resultText } from './interface.js';

export const DEFAULT_RERANK_BUDGET_TOKENS = 8192;

export function estimateTokens(text) {
  return Math.ceil(String(text).length / 4);
}

export function requiredTokens(query, results) {
  const queryTokens = estimateTokens(query);
  return results.length * queryTokens + results.reduce((sum, result) => sum + estimateTokens(resultText(result)), 0);
}

/** Throws the shared SemanticaError with stable code and numeric fields. */
export function assertRerankBudget(query, results, availableTokens = DEFAULT_RERANK_BUDGET_TOKENS) {
  if (!Number.isInteger(availableTokens) || availableTokens < 0) {
    throw new SemanticaError('E_INVALID_ARGUMENT',
      `reranker available budget must be a non-negative integer, got ${JSON.stringify(availableTokens)}`);
  }
  const required = requiredTokens(query, results);
  if (required > availableTokens) {
    const error = new SemanticaError('E_RERANK_BUDGET',
      `reranker requires ${required} tokens; available budget is ${availableTokens} tokens`);
    error.requiredTokens = required;
    error.availableTokens = availableTokens;
    throw error;
  }
  return { requiredTokens: required, availableTokens };
}

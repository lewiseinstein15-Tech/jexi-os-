/**
 * JEXI OS — Phase 28 Scope E — reranker public surface.
 *
 *   const rerank = createReranker({
 *     mode: 'tokenmax',
 *     backend: 'cross-encoder',
 *     provider,                 // injected; no network client in brain/**
 *     budgetTokens: 8192,
 *   });
 *   await rerank.rank(query, results, { topK: 20 });
 *   rerank.available() -> { available, backend }
 *
 * Defaults: mode='balanced' (OFF), backend='noop'. External failures are
 * fail-open; E_RERANK_BUDGET is an intentional pre-call refusal and propagates.
 */
import { SemanticaError } from '../../../semantica/_internal.js';
import {
  DEFAULT_RERANK_TOP_K, assertRankInput, assertBackend, rerankEnabled,
} from './interface.js';
import noop from './backends/noop.js';
import {
  createCrossEncoderBackend, DEFAULT_CROSS_ENCODER_MODEL,
} from './backends/cross-encoder.js';
import {
  DEFAULT_RERANK_BUDGET_TOKENS, assertRerankBudget,
} from './budget.js';

export function resolveRerankBackend(spec = 'noop', { provider, model } = {}) {
  if (typeof spec === 'object' && spec !== null) return assertBackend(spec);
  if (spec === 'noop' || spec === undefined) return noop;
  if (spec === 'cross-encoder' || spec === 'provider') {
    return createCrossEncoderBackend({ provider, model });
  }
  throw new SemanticaError('E_UNKNOWN_BACKEND',
    `unknown reranker backend ${JSON.stringify(spec)}; known: noop, cross-encoder (or an injected backend object)`);
}

export function createReranker({
  mode = 'balanced',
  backend = 'noop',
  provider,
  model = DEFAULT_CROSS_ENCODER_MODEL,
  budgetTokens = DEFAULT_RERANK_BUDGET_TOKENS,
  onFailOpen,
} = {}) {
  const configured = resolveRerankBackend(backend, { provider, model });

  const reportFailOpen = (detail) => {
    try { onFailOpen?.(detail); } catch { /* observability must never break search */ }
  };

  return {
    /** Current configured backend availability; mode does not alter capability. */
    available() {
      try {
        return { available: configured.available() === true, backend: configured.name };
      } catch {
        return { available: false, backend: configured.name };
      }
    },

    /**
     * rank(query, results, { backend?, topK=20 }) -> reranked[]
     * Only the head is sent; the untouched tail is appended in original order.
     */
    async rank(query, results, { backend: override, topK = DEFAULT_RERANK_TOP_K } = {}) {
      assertRankInput(query, results, topK);

      // Default OFF. Only tokenmax mode enables the reranker call path.
      if (!rerankEnabled(mode) || results.length === 0 || topK === 0) return results;

      const selected = override === undefined
        ? configured
        : resolveRerankBackend(override, { provider, model });

      let available = false;
      try { available = selected.available() === true; }
      catch (error) {
        reportFailOpen({ backend: selected.name, reason: 'availability-error', error });
        return results;
      }
      if (!available) {
        reportFailOpen({ backend: selected.name, reason: 'unavailable' });
        return results;
      }

      const head = results.slice(0, topK);
      const tail = results.slice(topK);

      // No provider cost for noop. Real/injected rerankers are budget-gated
      // BEFORE the call; this intentional refusal is not swallowed.
      if (selected !== noop) assertRerankBudget(query, head, budgetTokens);

      try {
        const rerankedHead = await selected.rank(query, head, { model });
        if (!Array.isArray(rerankedHead) || rerankedHead.length !== head.length) {
          throw new SemanticaError('E_BACKEND_CONTRACT',
            `reranker backend ${selected.name} returned ${Array.isArray(rerankedHead) ? rerankedHead.length : typeof rerankedHead} results for ${head.length} inputs`);
        }
        return [...rerankedHead, ...tail];
      } catch (error) {
        // The local budget refusal occurs before this try block. Therefore
        // EVERY backend/provider/network/auth/timeout/shape error here fails
        // open, even if an external error happens to reuse a local code.
        reportFailOpen({ backend: selected.name, reason: 'rank-error', error });
        return results;
      }
    },
  };
}

/** Process-local default: OFF + noop, therefore zero calls and no surprises. */
export const rerank = createReranker();

export {
  DEFAULT_RERANK_TOP_K, TOKENMAX_MODE, rerankEnabled, resultText,
} from './interface.js';
export {
  DEFAULT_RERANK_BUDGET_TOKENS, estimateTokens, requiredTokens, assertRerankBudget,
} from './budget.js';
export { noop } from './backends/noop.js';
export {
  createCrossEncoderBackend, isProviderAvailable, DEFAULT_CROSS_ENCODER_MODEL,
} from './backends/cross-encoder.js';

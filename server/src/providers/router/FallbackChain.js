/**
 * JEXI OS — Provider bridge — fallback chain.
 *
 * Executes a chat request across an ordered provider list, walking to the
 * next provider on ClassifiedError types that signal "try the next one":
 * not_configured, auth, rate_limit, transient, unsupported_capability.
 * Hard failures (invalid_request, unknown) stop the walk and propagate.
 */

import { ClassifiedError, classifyError } from '../error/classify.js';
import { isHardFailure } from '../error/retryability.js';

/**
 * @param {object} request  chat request ({ messages, tools, model, … })
 * @param {Array<{providerId: string, provider: object}>} chain
 * @param {object} [opts] { onFallback }
 * @returns {Promise<{response, providerId, model, attempts}>}
 */
export async function tryChain(request, chain, opts = {}) {
  const attempts = [];
  let lastErr = null;
  for (const { providerId, provider, model } of chain) {
    try {
      const resp = await provider.chat({ ...request, model: model ?? request.model });
      attempts.push({ providerId, status: 'ok' });
      return { response: resp, providerId, model: model ?? request.model, attempts };
    } catch (err) {
      const classified = err instanceof ClassifiedError ? err : classifyError(err, providerId);
      lastErr = classified;
      attempts.push({ providerId, status: 'fail', errorType: classified.type, message: classified.message });
      if (isHardFailure(classified)) break; // do not hide bugs behind fallback
      opts.onFallback?.(classified, providerId);
    }
  }
  throw lastErr ?? new ClassifiedError('unknown', 'empty fallback chain', { provider: 'chain' });
}
/**
 * JEXI OS — Provider bridge — retryability policy.
 *
 * Decides whether a classified error should be retried, with how long to back
 * off. The router uses this to walk the fallback chain; retry-after honors the
 * provider's hint when present.
 */

import { ClassifiedError } from './classify.js';

/**
 * @param {ClassifiedError} err
 * @param {object} [opts]
 * @param {number} [opts.attempt]    1-based attempt number
 * @param {number} [opts.maxAttempts] default 3
 * @returns {{ shouldRetry: boolean; delayMs: number; reason: string }}
 */
export function shouldRetry(err, { attempt = 1, maxAttempts = 3 } = {}) {
  if (!(err instanceof ClassifiedError)) {
    return { shouldRetry: false, delayMs: 0, reason: `unclassified error type: ${typeof err}` };
  }
  if (!err.retryable) {
    return { shouldRetry: false, delayMs: 0, reason: `${err.type} is not retryable` };
  }
  if (attempt >= maxAttempts) {
    return { shouldRetry: false, delayMs: 0, reason: `attempt ${attempt} >= max ${maxAttempts}` };
  }
  const base =
    err.type === 'rate_limit' ? 1_000 :
      err.type === 'context_overflow' ? 500 :
        250;
  const delayMs = err.retryAfterMs ?? base * 2 ** (attempt - 1);
  return { shouldRetry: true, delayMs, reason: `${err.type} retryable, backoff ${delayMs}ms` };
}

/** True when the error is a hard failure that should NOT trigger provider fallback. */
export function isHardFailure(err) {
  if (!(err instanceof ClassifiedError)) return false;
  return err.type === 'invalid_request' || err.type === 'unknown' || err.type === 'auth';
}
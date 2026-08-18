/**
 * B133 — LLM RETRY (DeepSeek Harness `packages/llm/llm-retry` mirror).
 *
 * Provider-routed retry with exponential backoff on transient failures:
 * HTTP 429 (rate limit), 5xx, network errors, and timeouts. Runs INSIDE
 * generateContent via a wrapped fetch so every provider benefits. Max 3
 * attempts, jittered backoff, retries are counted in telemetry.
 */

const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;

/** Delay for attempt n (1-based): 500ms * 2^(n-1) + jitter. */
export function retryDelayMs(attempt, random = Math.random) {
  const exponent = Math.min(attempt - 1, 4);
  return Math.min(500 * 2 ** exponent, 8000) + Math.round(random() * 250);
}

/** Is this error worth a retry? */
export function isRetryableError(err) {
  const s = String((err && (err.message || err.code)) || err || '');
  if (/429|rate.?limit|too many requests/i.test(s)) return true;
  if (/5\d\d|service unavailable|temporarily|upstream|gateway|timed? ?out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|fetch failed|network/i.test(s)) return true;
  return false;
}

/** Wrap an async fn with retry + backoff. */
export async function withRetry(fn, { attempts = MAX_ATTEMPTS, onRetry } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= Math.max(1, attempts); attempt++) {
    try {
      return await fn(attempt);
    } catch (e) {
      lastErr = e;
      if (attempt >= Math.max(1, attempts)) break;
      if (!isRetryableError(e)) throw e;
      if (typeof onRetry === 'function') { try { onRetry(attempt, e); } catch { /* noop */ } }
      await new Promise((r) => setTimeout(r, retryDelayMs(attempt)));
    }
  }
  throw lastErr;
}

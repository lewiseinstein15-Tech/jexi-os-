/**
 * JEXI OS — Phase 9 Scope A — Response sanitization (caps + safe errors).
 *
 * Two responsibilities, both modeled on the hardened-proxy doctrine:
 *
 * 1. Body caps. An upstream that streams an unbounded body (no/oversized
 *    Content-Length, chunked) must not OOM this process. The declared
 *    Content-Length is pre-checked, then the body is read incrementally with
 *    a running byte count; the stream is CANCELLED the moment the cap is
 *    crossed (never fully buffered). Returns { tooLarge, text, bytes }.
 *
 * 2. Error sanitization. Internal failure details (stacks, env, raw socket
 *    text) must never reach a model or a client. Every broker failure is
 *    mapped to a STABLE CODE + templated message; richer detail goes to the
 *    broker's local audit log only.
 */

export const DEFAULT_MAX_BYTES = 1 * 1024 * 1024; // 1 MiB
export const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Read a fetch Response body as text under a hard byte cap.
 * Mirrors the streaming-cap pattern: pre-check declared length, then read
 * chunk-by-chunk and cancel as soon as the ceiling is crossed.
 *
 * @param {Response} response
 * @param {number} maxBytes
 * @returns {Promise<{ tooLarge: boolean, text: string, bytes: number }>}
 */
export async function readBodyCapped(response, maxBytes = DEFAULT_MAX_BYTES) {
  const declared = Number(response.headers && response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    try { await response.body && response.body.cancel(); } catch { /* noop */ }
    return { tooLarge: true, text: '', bytes: 0 };
  }

  const body = response.body;
  if (!body || typeof body[Symbol.asyncIterator] !== 'function') {
    // No stream (test doubles, opaque bodies): read whole, then check.
    const text = await response.text();
    const bytes = Buffer.byteLength(text);
    return bytes > maxBytes
      ? { tooLarge: true, text: '', bytes }
      : { tooLarge: false, text, bytes };
  }

  const decoder = new TextDecoder();
  let text = '';
  let total = 0;
  for await (const chunk of body) {
    total += chunk.byteLength !== undefined ? chunk.byteLength : chunk.length;
    if (total > maxBytes) {
      try { await body.cancel(); } catch { /* noop */ }
      return { tooLarge: true, text, bytes: total };
    }
    text += decoder.decode(chunk, { stream: true });
  }
  text += decoder.decode();
  return { tooLarge: false, text, bytes: total };
}

/** Stable error codes the broker can emit (model/agent-visible surface). */
export const BROKER_ERROR_CODES = [
  'E_MALFORMED_URL',        // URL unparseable
  'E_INSECURE_SCHEME',      // not https
  'E_CREDENTIALS_IN_URL',   // user:pass@ present
  'E_NONSTANDARD_PORT',     // explicit port other than 443
  'E_UNREGISTERED_HOST',    // host not in registry
  'E_PATH_NOT_REGISTERED',  // host known, path not covered
  'E_REDIRECT_REFUSED',     // upstream tried to redirect
  'E_TIMEOUT',              // exceeded the wall-clock budget
  'E_TOO_LARGE',            // response body crossed the byte cap
  'E_UPSTREAM_STATUS',      // non-2xx upstream status
  'E_NETWORK',              // socket/DNS/TLS-level failure
];

const TEMPLATED = {
  E_MALFORMED_URL: 'request blocked: malformed URL',
  E_INSECURE_SCHEME: 'request blocked: only https is allowed',
  E_CREDENTIALS_IN_URL: 'request blocked: credentials in URL are forbidden',
  E_NONSTANDARD_PORT: 'request blocked: non-standard port',
  E_UNREGISTERED_HOST: 'request blocked: host is not registered',
  E_PATH_NOT_REGISTERED: 'request blocked: path is not registered for this host',
  E_REDIRECT_REFUSED: 'request blocked: upstream attempted a redirect',
  E_TIMEOUT: 'request blocked: upstream timed out',
  E_TOO_LARGE: 'request blocked: response exceeded the size cap',
  E_UPSTREAM_STATUS: 'request failed: upstream returned an error status',
  E_NETWORK: 'request failed: network error',
};

/**
 * Map any thrown value to a sanitized broker error:
 * { code, message } — code is stable, message is templated. No stacks, no
 * internal exception text, no environment details.
 */
export function sanitizeError(err) {
  if (err && err.name === 'AbortError') {
    return { code: 'E_TIMEOUT', message: TEMPLATED.E_TIMEOUT };
  }
  if (err && err.code && TEMPLATED[err.code]) {
    return { code: err.code, message: TEMPLATED[err.code] };
  }
  // Unknown internal failure: flat, honest, detail-free.
  return { code: 'E_NETWORK', message: TEMPLATED.E_NETWORK };
}

/** Shape of a broker warning (audit log + model-visible). */
export function makeWarning(code, message, at) {
  return { code, message, at: at || new Date().toISOString() };
}

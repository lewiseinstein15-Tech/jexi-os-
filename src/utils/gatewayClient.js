/**
 * B140 — GATEWAY CLIENT (DeepSeek Harness `packages/api/gateway` client
 * mirror, JEXI-branded).
 *
 * The browser-side API gateway client: a fetch wrapper that always sends
 * the JEXI access key, normalizes errors, and retries idempotent GETs with
 * capped exponential backoff. Every fetch in the app should go through here
 * (jexiFetch already exists for chat-path calls; this is the general
 * surface with retry + error shaping).
 *
 *   gatewayFetch(path, { method, body, retries, timeoutMs, key })
 *     → { ok, status, data } | throws GatewayError on network failure
 */

const DEFAULT_TIMEOUT_MS = 30000;
const MAX_RETRIES = 2;
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

export class GatewayError extends Error {
  constructor(message, { status = 0, code = null, data = null } = {}) {
    super(message);
    this.name = 'GatewayError';
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

/** Read the JEXI access key (Settings → System). */
export function getAccessKey() {
  try {
    return localStorage.getItem('jexi_access_key') || '';
  } catch { return ''; }
}

/** Sleep helper (capped backoff). */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * One gateway fetch with timeout + retry + error normalization.
 * @param {string} url absolute or relative URL
 * @param {object} opts { method, body, headers, retries, timeoutMs, key, signal }
 */
export async function gatewayFetch(url, opts = {}) {
  const { method = 'GET', body, headers = {}, retries = MAX_RETRIES, timeoutMs = DEFAULT_TIMEOUT_MS, key = null, signal } = opts;
  const finalKey = key !== null ? key : getAccessKey();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onOuterAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onOuterAbort, { once: true });
  }

  const attempt = async (n) => {
    try {
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(finalKey ? { 'x-jexi-key': finalKey } : {}),
          ...headers,
        },
        body: body !== undefined && method !== 'GET' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
        signal: controller.signal,
      });
      let data = null;
      const text = await res.text();
      try { data = text ? JSON.parse(text) : null; } catch { data = text; }
      if (res.ok) return { ok: true, status: res.status, data };
      if (RETRYABLE.has(res.status) && n < retries) {
        await sleep(500 * 2 ** n);
        return attempt(n + 1);
      }
      throw new GatewayError(
        (data && (data.error || data.message)) || `gateway ${res.status}`,
        { status: res.status, code: data && data.error, data },
      );
    } catch (e) {
      if (e instanceof GatewayError) throw e;
      if (e && e.name === 'AbortError') throw new GatewayError(`gateway request timed out after ${timeoutMs}ms`, { code: 'TIMEOUT' });
      if (n < retries) {
        await sleep(500 * 2 ** n);
        return attempt(n + 1);
      }
      throw new GatewayError(`gateway network error: ${(e && e.message) || e}`, { code: 'NETWORK' });
    }
  };

  try {
    return await attempt(0);
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onOuterAbort);
  }
}

/** Convenience: gatewayFetch + JSON data (throws GatewayError on failure). */
export async function gatewayGet(url, opts = {}) {
  return gatewayFetch(url, { ...opts, method: 'GET' });
}

/** Convenience: gatewayFetch with a JSON body (POST/PUT/DELETE). */
export async function gatewaySend(url, body, opts = {}) {
  return gatewayFetch(url, { ...opts, method: opts.method || 'POST', body });
}

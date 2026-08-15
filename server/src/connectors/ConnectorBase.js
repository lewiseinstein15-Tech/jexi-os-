/**
 * JEXI OS — Connector Base (Build 56).
 *
 * The connector system gives agents a typed, pluggable way to reach external
 * services (WhatsApp, GitHub, Email, Telegram, …). Every connector implements
 * the same contract:
 *
 *   authenticate() -> bool   — MUST actually call the provider (never just
 *                              checks that a key is present).
 *   send(payload)  -> dict   — one outbound action (message / email / issue…)
 *                              returns the provider's real response.
 *   receive(body)  -> list   — normalize an inbound payload (webhook or polled
 *                              message) into JEXI's internal event shape.
 *   healthCheck()  -> dict   — { status: 'ok' | 'error', detail }.
 *
 * This is the JavaScript adaptation of the connector directive (the project
 * is Node/ESM; the Python ABC/dataclass sketch maps 1:1 to class + config
 * object below). Error taxonomy is shared so every connector handles auth
 * failure, rate limits, timeouts and malformed responses the same way.
 */

/* ------------------------------------------------------------------ */
/* Error taxonomy — every failure is classified, never a bare throw.   */
/* ------------------------------------------------------------------ */

export const ERROR_CODES = {
  AUTH_FAILED: 'AUTH_FAILED',       // 401 / invalid credentials / token expired
  PERMISSION_DENIED: 'PERMISSION_DENIED', // 403 — authenticated but not allowed
  RATE_LIMITED: 'RATE_LIMITED',     // 429 — provider asked us to slow down
  TIMEOUT: 'TIMEOUT',               // request exceeded the time budget
  NETWORK: 'NETWORK',               // DNS / connection / TLS failure
  MALFORMED_RESPONSE: 'MALFORMED_RESPONSE', // 2xx but body is not what the API promises
  PROVIDER_ERROR: 'PROVIDER_ERROR', // 4xx/5xx provider-side failure
  NOT_CONFIGURED: 'NOT_CONFIGURED', // no credentials at all
};

export class ConnectorError extends Error {
  constructor(code, message, { status, retryAfter, provider, cause } = {}) {
    super(message);
    this.name = 'ConnectorError';
    this.code = code;
    this.status = status || null;
    this.retryAfter = retryAfter || null;
    this.provider = provider || null;
    this.cause = cause || null;
  }
}

/** Race a promise against a hard timeout — TIMEOUT error, not a hang. */
export function withTimeout(promise, ms, label = 'request') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new ConnectorError(ERROR_CODES.TIMEOUT, `${label} timed out after ${Math.round(ms / 1000)}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Fetch + JSON with the full failure taxonomy applied.
 *   - 401 → AUTH_FAILED, 403 → PERMISSION_DENIED
 *   - 429 → RATE_LIMITED (retryAfter from Retry-After / body)
 *   - network/abort → NETWORK / TIMEOUT
 *   - 2xx with unparseable JSON → MALFORMED_RESPONSE
 * Returns { status, data } on any HTTP response; throws ConnectorError only
 * for the classified failure cases above (plus non-2xx provider errors).
 */
export async function httpJson(url, { method = 'GET', headers = {}, body, timeout = 15000, provider, expect = null } = {}) {
  let res;
  try {
    res = await withTimeout(
      fetch(url, {
        method,
        headers: { Accept: 'application/json', ...headers },
        body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      }),
      timeout,
      `${provider || url}`
    );
  } catch (e) {
    if (e instanceof ConnectorError) throw e; // TIMEOUT already classified
    throw new ConnectorError(ERROR_CODES.NETWORK, `Network error talking to ${provider || url}: ${(e && e.message) || String(e)}`, { provider, cause: e });
  }

  let data = null;
  const raw = await res.text();
  if (raw) {
    try { data = JSON.parse(raw); }
    catch (e) {
      if (res.ok) throw new ConnectorError(ERROR_CODES.MALFORMED_RESPONSE, `${provider || url} returned ${res.status} with non-JSON body: ${raw.slice(0, 120)}`, { status: res.status, provider });
      // non-2xx with garbage body → treat as provider error with the raw text
      data = { raw };
    }
  }

  const retryAfter = (res.headers && res.headers.get && res.headers.get('retry-after'))
    || (data && (data.retry_after ?? data.retryAfter))
    || (data && data.parameters && (data.parameters.retry_after ?? data.parameters.retryAfter)); // Telegram nests it under parameters
  if (res.status === 401) throw new ConnectorError(ERROR_CODES.AUTH_FAILED, `Auth failed for ${provider || url} (HTTP 401)`, { status: 401, provider });
  if (res.status === 403) {
    // Keep the provider's own words (GitHub: "Resource not accessible by
    // integration" vs "token does not have permission to create issues" vs
    // rate limit) — a bare 403 hides which one this is.
    const detail = data && (data.message || (data.error && data.error.message));
    throw new ConnectorError(ERROR_CODES.PERMISSION_DENIED, `${provider || url} refused the request (HTTP 403)${detail ? `: ${String(detail).slice(0, 200)}` : ''}`, { status: 403, provider, cause: data });
  }
  if (res.status === 429) throw new ConnectorError(ERROR_CODES.RATE_LIMITED, `${provider || url} rate-limited (HTTP 429)`, { status: 429, retryAfter: retryAfter != null ? Number(retryAfter) : null, provider });
  if (!res.ok) {
    const msg = data?.error?.message || data?.message || data?.raw || `HTTP ${res.status}`;
    throw new ConnectorError(ERROR_CODES.PROVIDER_ERROR, `${provider || url} failed (HTTP ${res.status}): ${String(msg).slice(0, 300)}`, { status: res.status, provider, cause: data });
  }
  if (expect && data === null) {
    throw new ConnectorError(ERROR_CODES.MALFORMED_RESPONSE, `${provider || url} returned an empty body`, { status: res.status, provider });
  }
  return { status: res.status, data };
}

/** HMAC-SHA256 hex digest of rawBody (provider webhook signature checks). */
export function createHmacSha256(secret, rawBody) {
  return crypto.createHmac('sha256', String(secret)).update(rawBody, 'utf8').digest('hex');
}

/** HMAC-SHA1 hex digest (GitHub's legacy X-Hub-Signature). */
export function createHmacSha1(secret, rawBody) {
  return crypto.createHmac('sha1', String(secret)).update(rawBody, 'utf8').digest('hex');
}

/** Mask credential-like values for any user-facing output. */
export function maskSecret(value, keep = 4) {
  if (value == null || value === '') return '';
  const s = String(value);
  if (s.length <= keep + 2) return '••••';
  return `••••${s.slice(-keep)}`;
}

/**
 * B59 — reject secrets that contain non-ASCII characters (a stray emoji or
 * smart-quote from copy-paste) BEFORE the request goes out. Node's fetch
 * otherwise dies with an opaque "Cannot convert argument to a ByteString…"
 * TypeError when serializing the header; this surfaces the real cause: the
 * stored value is corrupted and must be re-pasted.
 */
export function assertAsciiSecret(value, label = 'secret') {
  const s = String(value == null ? '' : value);
  if (/[^\x00-\x7F]/.test(s)) {
    throw new ConnectorError(
      ERROR_CODES.PROVIDER_ERROR,
      `${label} contains non-ASCII characters (e.g. an emoji or smart-quote from copy-paste) at position ${s.search(/[^\x00-\x7F]/)} — the stored value is corrupted. Re-paste ${label} exactly as shown in the provider dashboard.`
    );
  }
  return s;
}

import crypto from 'crypto';

/* ------------------------------------------------------------------ */
/* ConnectorConfig — a plain config object with masking helpers.       */
/* ------------------------------------------------------------------ */

export class ConnectorConfig {
  constructor({ name, auth = {}, enabled = true, meta = {} } = {}) {
    if (!name) throw new Error('ConnectorConfig requires a name');
    this.name = name;
    this.auth = auth || {};
    this.enabled = enabled !== false;
    this.meta = meta || {};
  }

  /** Auth with every secret-like value masked (safe for API/UI responses). */
  masked() {
    const out = {};
    for (const [k, v] of Object.entries(this.auth || {})) {
      out[k] = /token|secret|key|password|private|webhook/i.test(k) ? maskSecret(v) : v;
    }
    return out;
  }

  get configured() {
    return Object.keys(this.auth || {}).length > 0;
  }

  toJSON() {
    return { name: this.name, enabled: this.enabled, auth: this.masked(), meta: this.meta || {} };
  }
}

/* ------------------------------------------------------------------ */
/* Connector — abstract base. Concrete connectors override the four    */
/* methods; the base provides shared HTTP + config plumbing.           */
/* ------------------------------------------------------------------ */

export class Connector {
  /** Name used for tool naming (send_<toolName>). */
  static toolName = 'connector';

  constructor(config) {
    if (!(config instanceof ConnectorConfig)) {
      config = new ConnectorConfig(config || {});
    }
    this.config = config;
  }

  /** Provider display name, e.g. "WhatsApp Business Cloud API". */
  get label() { return this.constructor.name; }

  /** Base URL override — tests point this at a local mock server. */
  get baseUrl() { return this.config.auth.baseUrl || this.defaultBaseUrl; }
  get defaultBaseUrl() { throw new ConnectorError(ERROR_CODES.NOT_CONFIGURED, `${this.constructor.name} has no default base URL`); }

  /** Per-connector request timeout (config.auth.requestTimeout, ms). */
  get requestTimeoutMs() { return Number(this.config.auth.requestTimeout) || 15000; }

  /** Human description for the generated agent tool schema. */
  toolDescription() { return `${this.label} connector (send outbound actions via JEXI).`; }

  /** JSON schema describing send(payload) fields — merged with the
   *  introspected send() signature by the tool bridge. */
  static sendSchema() { return {}; }

  /** Introspectable signature of send() — see toolBridge.js. */
  async send(payload) { // eslint-disable-line no-unused-vars
    throw new ConnectorError(ERROR_CODES.NOT_CONFIGURED, `${this.constructor.name}.send() is not implemented`, { provider: this.label });
  }

  async authenticate() { // eslint-disable-line no-unused-vars
    throw new ConnectorError(ERROR_CODES.NOT_CONFIGURED, `${this.constructor.name}.authenticate() is not implemented`, { provider: this.label });
  }

  async receive(inbound) { // eslint-disable-line no-unused-vars
    return [];
  }

  async healthCheck() {
    try {
      const ok = await this.authenticate();
      return { status: ok ? 'ok' : 'error', detail: 'authenticated with the provider' };
    } catch (e) {
      return { status: 'error', detail: (e && e.message) || String(e), code: e && e.code };
    }
  }
}

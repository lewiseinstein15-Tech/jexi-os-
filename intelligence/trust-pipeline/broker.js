/**
 * JEXI OS — Phase 9 Scope A — Hardened broker for external data.
 *
 * CONTRACT: any external data that reaches a model passes through this
 * broker. No raw fetches in agent logic.
 *
 * Pipeline per request:
 *   1. URL shape checks (https, no userinfo, no ports)          [allowlist]
 *   2. Registry match — host exact + path prefix                [allowlist]
 *   3. fetch with redirect: 'manual' — ANY 3xx is refused
 *      (Scope B adds per-hop revalidation for explicitly
 *      redirect-tolerant registrations; the default is refuse)
 *   4. hard wall-clock timeout via AbortController
 *   5. body read under a hard byte cap (stream cancelled on breach)
 *   6. non-2xx → sanitized upstream error; all errors sanitized
 *
 * Everything the model sees is either sanitized data or a stable error code.
 * Richer diagnostics go to the broker's local audit log (this process only).
 *
 * Research basis (contracts only — clean-room implementation):
 * bilawalsidhu/gods-eye-view SECURITY.md "No arbitrary-URL fetching",
 * "Response-size caps and timeouts", "sanitized errors"; and its
 * server/providers/common/http.js capped-body pattern.
 */

import { resolveAllowed, AllowlistRefusedError } from './allowlist.js';
import {
  readBodyCapped,
  sanitizeError,
  makeWarning,
  DEFAULT_MAX_BYTES,
  DEFAULT_TIMEOUT_MS,
} from './sanitize.js';

export function createBroker({
  maxBytes = DEFAULT_MAX_BYTES,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = (...args) => fetch(...args),
  userAgent = 'jexi-os-phase9-trust-pipeline/1.0',
} = {}) {
  if (!(Number.isInteger(maxBytes) && maxBytes > 0)) {
    throw new Error('createBroker: maxBytes must be a positive integer');
  }
  if (!(Number.isInteger(timeoutMs) && timeoutMs > 0)) {
    throw new Error('createBroker: timeoutMs must be a positive integer');
  }

  /** Local audit log: warnings + sanitized refusals (process-local only). */
  const audit = [];

  const logWarning = (code, message, extra) => {
    const entry = { ...makeWarning(code, message), ...(extra ? { extra } : {}) };
    audit.push(entry);
    return entry;
  };

  /**
   * Fetch a registered https URL through the full pipeline.
   * @param {string} rawUrl
   * @param {{ headers?: object, maxBytes?: number }} [opts]
   * @returns {Promise<{
   *   ok: boolean, status: number, url: string, registration: object,
   *   text: string, bytes: number, tooLarge: boolean, warnings: object[],
   *   json: () => unknown,
   * }>}
   * On refusal/failure: { ok: false, error: { code, message }, warnings }
   */
  async function fetchThroughBroker(rawUrl, opts = {}) {
    const warnings = [];
    const cap = Number.isInteger(opts.maxBytes) ? opts.maxBytes : maxBytes;

    // 1+2. allowlist decision (never throws out of here un-sanitized)
    let decision;
    try {
      decision = resolveAllowed(rawUrl);
    } catch (err) {
      const code = err instanceof AllowlistRefusedError ? err.code : 'E_NETWORK';
      const detail = err instanceof AllowlistRefusedError ? err.detail : 'internal';
      logWarning(code, `refused: ${detail}`, { url: String(rawUrl) });
      return {
        ok: false,
        status: 0,
        url: String(rawUrl),
        registration: null,
        text: '',
        bytes: 0,
        tooLarge: false,
        warnings,
        error: { code, message: sanitizeError(err).message },
      };
    }
    const { url, registration } = decision;

    // 3+4. fetch: manual redirects (refuse), hard timeout
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(url.toString(), {
        method: 'GET',
        headers: {
          'user-agent': userAgent,
          accept: 'application/json,text/csv;q=0.9,text/plain;q=0.8',
          ...(opts.headers || {}),
        },
        redirect: 'manual', // any 3xx surfaces as a 3xx response, never auto-followed
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      const sanitized = sanitizeError(err);
      logWarning(sanitized.code, `fetch failed: ${sanitized.code}`, {
        url: url.toString(),
      });
      return {
        ok: false, status: 0, url: url.toString(), registration,
        text: '', bytes: 0, tooLarge: false, warnings,
        error: sanitized,
      };
    }
    clearTimeout(timer);

    // 3b. redirect refusal (3xx never followed by the trust pipeline)
    if (response.status >= 300 && response.status < 400) {
      try { await response.body && response.body.cancel(); } catch { /* noop */ }
      logWarning('E_REDIRECT_REFUSED', 'upstream attempted a redirect', {
        url: url.toString(),
      });
      return {
        ok: false, status: response.status, url: url.toString(), registration,
        text: '', bytes: 0, tooLarge: false, warnings,
        error: { code: 'E_REDIRECT_REFUSED', message: 'request blocked: upstream attempted a redirect' },
      };
    }

    // 5. capped body read
    const effectiveCap = cap;
    const body = await readBodyCapped(response, effectiveCap);
    if (body.tooLarge) {
      logWarning('E_TOO_LARGE', `response exceeded ${effectiveCap} bytes — stream cancelled`, {
        url: url.toString(),
        declaredCap: effectiveCap,
      });
      warnings.push(makeWarning(
        'W_BODY_CAPPED',
        `response exceeded the ${effectiveCap}-byte cap and was truncated/cancelled`,
      ));
    }

    // 6. status gate
    if (response.status < 200 || response.status >= 300) {
      logWarning('E_UPSTREAM_STATUS', `upstream status ${response.status}`, {
        url: url.toString(),
      });
      return {
        ok: false, status: response.status, url: url.toString(), registration,
        text: '', bytes: body.bytes, tooLarge: body.tooLarge, warnings,
        error: { code: 'E_UPSTREAM_STATUS', message: `request failed: upstream returned an error status` },
      };
    }

    if (body.tooLarge) {
      return {
        ok: false, status: response.status, url: url.toString(), registration,
        text: '', bytes: body.bytes, tooLarge: true, warnings,
        error: { code: 'E_TOO_LARGE', message: 'request blocked: response exceeded the size cap' },
      };
    }

    return {
      ok: true,
      status: response.status,
      url: url.toString(),
      registration,
      text: body.text,
      bytes: body.bytes,
      tooLarge: false,
      warnings,
      json() {
        return JSON.parse(body.text);
      },
    };
  }

  return {
    fetch: fetchThroughBroker,
    /** Governance surface: caps, timeouts, audit log snapshot. */
    status() {
      return { maxBytes, timeoutMs, auditEntries: audit.length, audit: [...audit] };
    },
  };
}

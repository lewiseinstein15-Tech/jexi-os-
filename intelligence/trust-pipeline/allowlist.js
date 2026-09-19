/**
 * JEXI OS — Phase 9 Scope A — URL allowlist (registered-URL-only policy).
 *
 * The single decision point the broker consults before any outbound fetch.
 * A URL is fetchable iff:
 *   1. scheme is exactly https:
 *   2. no userinfo (user:pass@) in the URL
 *   3. no explicit port (443 only — the default)
 *   4. hostname (case-insensitive, trailing dot stripped) matches a
 *      registration's host EXACTLY — no wildcards, no subdomain inference
 *   5. the URL's path is under one of that registration's pathPrefixes
 *
 * Nothing else relaxes these rules. New access = new registration, in code,
 * reviewed like any other security boundary change.
 */

import { REGISTERED_URLS } from './registered-urls.js';

export class AllowlistRefusedError extends Error {
  /**
   * @param {string} code   stable machine-readable reason
   * @param {string} detail operator-facing detail (kept OUT of model-visible text)
   */
  constructor(code, detail) {
    super(`${code}: ${detail}`);
    this.name = 'AllowlistRefusedError';
    this.code = code;
    this.detail = detail;
  }
}

function normalizeHost(hostname) {
  return String(hostname || '').toLowerCase().replace(/\.+$/, '');
}

/**
 * Parse + validate the URL shape, then find the matching registration.
 * @returns {{ registration: object, url: URL }}
 * @throws AllowlistRefusedError with a stable code on any refusal
 */
export function resolveAllowed(rawUrl, registry = REGISTERED_URLS) {
  let url;
  try {
    url = new URL(String(rawUrl));
  } catch {
    throw new AllowlistRefusedError('E_MALFORMED_URL', 'unparseable URL');
  }

  if (url.protocol !== 'https:') {
    throw new AllowlistRefusedError(
      'E_INSECURE_SCHEME',
      `scheme ${url.protocol} is not https`,
    );
  }
  if (url.username || url.password) {
    throw new AllowlistRefusedError(
      'E_CREDENTIALS_IN_URL',
      'userinfo is forbidden in registered URLs',
    );
  }
  if (url.port) {
    throw new AllowlistRefusedError(
      'E_NONSTANDARD_PORT',
      `port ${url.port} is forbidden (443 only)`,
    );
  }

  const host = normalizeHost(url.hostname);
  const path = url.pathname || '/';

  const registration = registry.find(
    (r) => normalizeHost(r.host) === host &&
      (r.pathPrefixes || []).some((p) => {
        // prefix matches if the path equals it exactly or lives under it
        // (prefix treated as a directory boundary: '/api/states' covers
        // '/api/states' and '/api/states/all', but not '/api/statesfoo')
        if (path === p) return true;
        const dir = p.endsWith('/') ? p : p + '/';
        return path.startsWith(dir);
      }),
  );

  if (!registration) {
    // Distinguish "host unknown" from "path not covered" for the audit log.
    const hostKnown = registry.some((r) => normalizeHost(r.host) === host);
    throw new AllowlistRefusedError(
      hostKnown ? 'E_PATH_NOT_REGISTERED' : 'E_UNREGISTERED_HOST',
      hostKnown
        ? `path ${path} is not registered for ${host}`
        : `host ${host} is not registered`,
    );
  }

  return { registration, url };
}

/**
 * Check-only variant: never throws; returns { allowed, code?, registration? }.
 * Useful for UI/governance surfaces that want a verdict, not an exception.
 */
export function checkAllowed(rawUrl, registry = REGISTERED_URLS) {
  try {
    const { registration, url } = resolveAllowed(rawUrl, registry);
    return { allowed: true, registration, url: url.toString() };
  } catch (err) {
    if (err instanceof AllowlistRefusedError) {
      return { allowed: false, code: err.code, detail: err.detail };
    }
    return { allowed: false, code: 'E_INTERNAL', detail: String(err && err.message) };
  }
}

/** Register an additional URL at runtime (governance-auditable; see Scope C). */
export function registerUrl(entry, registry = REGISTERED_URLS) {
  for (const field of ['id', 'host', 'pathPrefixes']) {
    if (!entry || !entry[field]) {
      throw new Error(`registerUrl: missing required field '${field}'`);
    }
  }
  if (registry.some((r) => r.id === entry.id)) {
    throw new Error(`registerUrl: duplicate id '${entry.id}'`);
  }
  registry.push(entry);
  return entry;
}

/** Snapshot of the registry for enumeration (Scope C consumes this). */
export function listRegistrations(registry = REGISTERED_URLS) {
  return registry.map((r) => ({ ...r }));
}

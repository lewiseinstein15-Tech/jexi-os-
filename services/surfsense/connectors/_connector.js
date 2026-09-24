/**
 * JEXI OS — Phase 19 Scope A — the connector interface contract.
 *
 * Pattern taken from SurfSense (MODSetter/SurfSense, surfsense_backend/app/
 * connectors/): every connector is a uniformly shaped object that declares its
 * capabilities up front, exposes one search/ingest entry point, and can be
 * validated. SurfSense ships a ConnectorError hierarchy (auth / rate-limit /
 * timeout / api) plus per-connector classes constructed with credentials in
 * the ctor; here that becomes a single uniform contract with typed E_* codes
 * (Phase 27 style) and truthful live/auth declaration.
 *
 * Contract:
 *   connector.name          -> string
 *   connector.capabilities  -> { live: bool, auth: 'none' | 'oauth' | 'token' }
 *   connector.fetch(query, opts) -> { documents[] }   // provenance-bearing
 *   connector.assert()      -> throws E_CONNECTOR_INCOMPLETE if shape invalid
 *
 * Document provenance shape:
 *   { source: string, url?: string, fetchedAt: string(ISO), text: string }
 *
 * Truthfulness rule (Phase 19 spec): connectors that require live credentials
 * unavailable in the sandbox MUST declare live: false and their fetch() MUST
 * throw E_LIVE_UNAVAILABLE. A live response is never faked.
 */
import { SurfError } from './_internal.js';

export const AUTH_MODES = ['none', 'oauth', 'token'];

/** Validate a provenance document. Throws E_CONNECTOR_INCOMPLETE on bad shape. */
export function assertDocument(doc, connectorName) {
  const where = `connector "${connectorName}" document`;
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new SurfError('E_CONNECTOR_INCOMPLETE', `${where} must be an object`);
  }
  if (typeof doc.source !== 'string' || doc.source.length === 0) {
    throw new SurfError('E_CONNECTOR_INCOMPLETE', `${where} is missing non-empty string "source"`);
  }
  if (typeof doc.text !== 'string' || doc.text.length === 0) {
    throw new SurfError('E_CONNECTOR_INCOMPLETE', `${where} is missing non-empty string "text"`);
  }
  if (typeof doc.fetchedAt !== 'string' || Number.isNaN(Date.parse(doc.fetchedAt))) {
    throw new SurfError('E_CONNECTOR_INCOMPLETE', `${where} is missing ISO-string "fetchedAt"`);
  }
  if (doc.url !== undefined && (typeof doc.url !== 'string' || doc.url.length === 0)) {
    throw new SurfError('E_CONNECTOR_INCOMPLETE', `${where} has non-string "url"`);
  }
  return doc;
}

/** Validate full connector shape. Throws E_CONNECTOR_INCOMPLETE on any defect. */
export function assertConnector(candidate) {
  const where = 'connector';
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new SurfError('E_CONNECTOR_INCOMPLETE', `${where} must be an object`);
  }
  if (typeof candidate.name !== 'string' || candidate.name.length === 0) {
    throw new SurfError('E_CONNECTOR_INCOMPLETE', `${where} is missing non-empty string "name"`);
  }
  const label = `connector "${candidate.name}"`;
  const caps = candidate.capabilities;
  if (caps === null || typeof caps !== 'object' || Array.isArray(caps)) {
    throw new SurfError('E_CONNECTOR_INCOMPLETE', `${label} is missing "capabilities" object`);
  }
  if (typeof caps.live !== 'boolean') {
    throw new SurfError('E_CONNECTOR_INCOMPLETE', `${label} capabilities.live must be a boolean`);
  }
  if (!AUTH_MODES.includes(caps.auth)) {
    throw new SurfError(
      'E_CONNECTOR_INCOMPLETE',
      `${label} capabilities.auth must be one of ${AUTH_MODES.join('|')}`
    );
  }
  if (typeof candidate.fetch !== 'function') {
    throw new SurfError('E_CONNECTOR_INCOMPLETE', `${label} is missing fetch(query, opts) function`);
  }
  return candidate;
}

/**
 * Factory: build a frozen, self-asserting connector from a definition.
 * The returned object is the uniform surface every connector in this
 * directory exposes (SurfSense: one class per source; here: one factory).
 */
export function createConnector(definition) {
  const { name, capabilities, fetch } = definition ?? {};
  const connector = {
    name,
    capabilities,
    fetch,
    assert() {
      return assertConnector(this);
    },
  };
  // Enforced at creation as well as at registry load: a malformed connector
  // cannot even exist as a createConnector() result.
  return Object.freeze(assertConnector(connector));
}

/**
 * Standard fetch() body for connectors whose live credentials are not
 * available in this sandbox. Truthful per spec: live: false, and every call
 * throws E_LIVE_UNAVAILABLE naming the auth mode and required credentials.
 */
export function liveUnavailableFetch(name, auth, requiredEnv) {
  const envList = requiredEnv.length > 0 ? requiredEnv.join(', ') : 'none declared';
  return () => {
    throw new SurfError(
      'E_LIVE_UNAVAILABLE',
      `connector "${name}" (auth: ${auth}) cannot fetch live in this sandbox; ` +
        `requires credentials: ${envList}`
    );
  };
}

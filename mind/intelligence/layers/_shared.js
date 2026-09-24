/**
 * JEXI OS — Phase 9 Scope I — shared layer infrastructure.
 *
 * Zone: intelligence/layers/**. Imports ONLY foreign zones through their
 * public seams (Scope A trust pipeline, Scope G provenance engine) — no
 * foreign file is modified.
 *
 * RULES ENFORCED HERE (per the Scope I block)
 *   1. Every external fetch goes through the Scope A trust-pipeline broker.
 *      No layer performs a raw fetch. Allowlist bypasses are impossible by
 *      construction: the broker refuses anything not in registered-urls.js.
 *   2. Every returned point carries a Scope G provenance label, attached
 *      here from layer-declared metadata. Real fetch → 'observed'.
 *      Derived → 'estimated' (confidence REQUIRED, Scope G rule 3).
 *      The engine refuses unlabeled sets at the egress gate (assertAll).
 *   3. Coordinates are normalized to WGS84 lat/lon (decimal degrees).
 *   4. check() is a REAL probe through the same broker — never `which()`,
 *      never a static string.
 *   5. When a source cannot serve data, layers throw E_LAYER_UNAVAILABLE
 *      (or a more specific code) with the SPECIFIC reason. No simulated
 *      or placeholder points are ever produced.
 */

import { createBroker } from '../trust-pipeline/broker.js';
import { checkAllowed } from '../trust-pipeline/allowlist.js';
import { getRegistration } from '../trust-pipeline/registered-urls.js';
import {
  attach,
  assertAll,
} from '../../events/provenance/label.js';

/* ------------------------------------------------------------------ */
/* layer errors                                                        */
/* ------------------------------------------------------------------ */

/** Stable codes a layer can refuse with (superset of the scope block). */
export const LAYER_ERROR_CODES = Object.freeze([
  'E_LAYER_UNAVAILABLE', // source cannot serve data right now (cause carries the specific broker/allowlist code)
  'E_MISSING_KEY',       // layer needs an API key and none is configured
  'E_BAD_RESPONSE',      // upstream answered but the payload is unusable
  'E_BAD_COORD',         // coordinate cannot be normalized to WGS84
]);

export class LayerError extends Error {
  /**
   * @param {string} code one of LAYER_ERROR_CODES
   * @param {string} message specific, honest, surface-safe reason
   * @param {{ cause?: { code?: string, message?: string } }} [opts]
   */
  constructor(code, message, opts = {}) {
    super(message);
    this.name = 'LayerError';
    this.code = code;
    if (opts.cause) this.cause = opts.cause;
  }
}

/* ------------------------------------------------------------------ */
/* trust-pipeline transport (the ONLY outbound path for layers)        */
/* ------------------------------------------------------------------ */

// One shared broker for all layers: Scope B SSRF shield is the default
// transport, 25 s wall-clock budget, per-call byte caps below.
const sharedBroker = createBroker({ timeoutMs: 25_000 });

/**
 * Fetch through the trust pipeline. Returns the raw broker result
 * ({ ok, status, text, bytes, registration, error, ... }) — for layers
 * and probes that need to distinguish outcomes without exception
 * control flow. This is also the honest way to demonstrate allowlist
 * enforcement (the broker REFUSES, it does not throw past the caller).
 * @param {string} url
 * @param {{ maxBytes?: number }} [opts]
 */
export function brokerFetch(url, opts = {}) {
  return sharedBroker.fetch(url, { maxBytes: opts.maxBytes });
}

/**
 * Fetch + JSON-parse through the trust pipeline, throwing LayerError on
 * any refusal/failure. The broker's stable code is preserved as `cause`
 * and quoted in the message so callers always see the SPECIFIC reason.
 * @param {string} url
 * @param {{ maxBytes?: number }} [opts]
 * @returns {Promise<{ body: any, registration: object, bytes: number }>}
 */
export async function fetchJson(url, opts = {}) {
  const result = await sharedBroker.fetch(url, { maxBytes: opts.maxBytes ?? 1_500_000 });
  if (!result.ok) {
    throw new LayerError(
      'E_LAYER_UNAVAILABLE',
      `source unavailable: ${result.error.code} — ${result.error.message} (requested ${url})`,
      { cause: result.error },
    );
  }
  let body;
  try {
    body = JSON.parse(result.text);
  } catch {
    throw new LayerError(
      'E_BAD_RESPONSE',
      `upstream answered HTTP ${result.status} with ${result.bytes} bytes that do not parse as JSON (requested ${url})`,
    );
  }
  return { body, registration: result.registration, bytes: result.bytes };
}

/* ------------------------------------------------------------------ */
/* WGS84 normalization                                                 */
/* ------------------------------------------------------------------ */

/**
 * Normalize latitude to WGS84 decimal degrees.
 * @param {number|string} v
 * @returns {number}
 * @throws LayerError E_BAD_COORD (latitude cannot be wrapped — out-of-range is refused, not bent)
 */
export function normalizeLat(v) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < -90 || n > 90) {
    throw new LayerError('E_BAD_COORD', `latitude ${JSON.stringify(v)} is not a finite WGS84 degree in [-90, 90]`);
  }
  return n;
}

/**
 * Normalize longitude to WGS84 decimal degrees, wrapping into [-180, 180]
 * (antimeridian wrap is a legal identity for longitudes: 271° → -89°).
 * @param {number|string} v
 * @returns {number}
 * @throws LayerError E_BAD_COORD
 */
export function normalizeLon(v) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    throw new LayerError('E_BAD_COORD', `longitude ${JSON.stringify(v)} is not a finite number`);
  }
  return ((n + 540) % 360) - 180;
}

/**
 * Build a contract-shaped point { lat, lon, ...data }. lat/lon are
 * normalized to WGS84 first; duplicate lat/lon keys inside data are dropped.
 * @param {Record<string, unknown>} data
 * @param {{ lat: number|string, lon: number|string }} coords
 */
export function makePoint(data, { lat, lon }) {
  const rest = { ...data };
  delete rest.lat;
  delete rest.lon;
  return { lat: normalizeLat(lat), lon: normalizeLon(lon), ...rest };
}

/* ------------------------------------------------------------------ */
/* provenance glue (Scope G engine — no local reimplementation)         */
/* ------------------------------------------------------------------ */

/**
 * Attach a Scope G provenance label to one point and flatten the envelope
 * so the point keeps the contract shape { lat, lon, ...data, provenance }.
 *
 * @param {Record<string, unknown>} pointData WITHOUT a provenance key
 * @param {{ label?: 'observed'|'estimated'|'simulated'|'reconstructed',
 *           source: string, method: string, confidence?: number,
 *           notes?: string }} meta
 * @returns the flat labeled point (provenance object is frozen by the engine)
 */
export function labelPoint(pointData, meta) {
  if (pointData === null || typeof pointData !== 'object' || Array.isArray(pointData)) {
    throw new LayerError('E_BAD_RESPONSE', 'labelPoint: point data must be a plain object');
  }
  if ('data' in pointData || 'provenance' in pointData) {
    throw new LayerError(
      'E_BAD_RESPONSE',
      "labelPoint: point data must not carry 'data' or 'provenance' keys — build fresh data objects",
    );
  }
  const envelope = attach(pointData, { label: 'observed', ...meta });
  return { ...envelope.data, provenance: envelope.provenance };
}

/**
 * Egress gate for layer result sets: every point must carry schema-valid
 * provenance or the fetch fails loudly (Scope G rule 1). Returns the SAME
 * array (gated) so layers can `return assertLabeled(points)`.
 * @param {Array} points
 * @returns {Array} the gated points
 * @throws ProvenanceError (from the Scope G engine) naming the offending point
 */
export function assertLabeled(points) {
  assertAll(points);
  return points;
}

/* ------------------------------------------------------------------ */
/* check(): real probe through the same broker                         */
/* ------------------------------------------------------------------ */

/**
 * Real probe used by every layer's check(). Resolves the URL against the
 * allowlist FIRST (a source with no registration is reported as
 * 'unregistered' without a network round-trip — that IS its honest state),
 * then performs a real brokered fetch and maps the outcome to a specific
 * status. Never throws; never shells out (`which()` is forbidden here).
 *
 * statuses:
 *   ok            — real HTTP 2xx through the trust pipeline
 *   unavailable   — registered, but network/timeout/HTTP-error/size refusal
 *   unregistered  — host or path not in registered-urls.js (zone-owner task)
 *   unauthorized  — source demands credentials we do not hold
 *
 * @param {string} url the layer's canonical endpoint
 * @param {{ layerId: string, maxBytes?: number }} opts
 * @returns {Promise<{ status: string, message: string }>}
 */
export async function probeSource(url, opts) {
  const { layerId, maxBytes = 400_000 } = opts;
  const verdict = checkAllowed(url);
  if (!verdict.allowed) {
    return {
      status: verdict.code === 'E_UNREGISTERED_HOST' || verdict.code === 'E_PATH_NOT_REGISTERED'
        ? 'unregistered'
        : 'unavailable',
      message: `${verdict.code}: ${verdict.detail} — endpoint is not usable through the trust pipeline; ` +
        `zone-owner task: register it for layer '${layerId}' in intelligence/trust-pipeline/registered-urls.js`,
    };
  }
  const reg = getRegistration(verdict.registration.id);
  const governance = reg && reg.layer === layerId
    ? 'registration layer match: yes'
    : `registration serves layer '${reg && reg.layer}' — MISMATCH with '${layerId}'`;
  const t0 = Date.now();
  const result = await sharedBroker.fetch(url, { maxBytes });
  const ms = Date.now() - t0;
  if (result.ok) {
    return {
      status: 'ok',
      message: `HTTP ${result.status}, ${result.bytes} bytes in ${ms}ms via registration ${reg.id} — ${governance}`,
    };
  }
  const code = result.error ? result.error.code : 'E_NETWORK';
  const status = code === 'E_UPSTREAM_STATUS' && (result.status === 401 || result.status === 403)
    ? 'unauthorized'
    : 'unavailable';
  return {
    status,
    message: `${code}: ${result.error ? result.error.message : 'network failure'}` +
      `${result.status ? ` (HTTP ${result.status})` : ''} in ${ms}ms via registration ${reg ? reg.id : '??'} — ${governance}`,
  };
}

/* ------------------------------------------------------------------ */
/* minimal CSV reader (fires / bikeshare — plain RFC4180 subset)       */
/* ------------------------------------------------------------------ */

/**
 * Parse a small CSV body into rows of string fields. Deliberately minimal
 * and honest: quoted fields are REFUSED (E_BAD_RESPONSE) rather than
 * silently mis-parsed. FIRMS and GBFS CSVs contain no quoted fields.
 * @param {string} text
 * @returns {string[][]} rows (header included), cells trimmed
 */
export function parseCsvRows(text) {
  const lines = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter((l) => l !== '');
  return lines.map((line) => {
    if (line.includes('"')) {
      throw new LayerError('E_BAD_RESPONSE', 'CSV contains quoted fields — minimal layer parser refuses rather than mis-parse');
    }
    return line.split(',').map((c) => c.trim());
  });
}

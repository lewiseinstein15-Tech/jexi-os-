/**
 * JEXI OS — Phase 9 Scope I — flights layer (OpenSky + adsb.lol).
 *
 * Zone: intelligence/layers/**. Transport: Scope A trust pipeline ONLY
 * (registrations 'opensky-states' and 'adsb-lol', keyless, provenance
 * 'observed'). No raw fetch. No simulated points.
 *
 * Build-time sandbox status: OpenSky VERIFIED REACHABLE (brokered HTTP 200,
 * ~0.8 MB state vector). adsb.lol answered 503 at build time — it is the
 * coded FALLBACK path, probed live when OpenSky fails, and reported
 * honestly if it is down. check() re-probes the primary live every call.
 */

import { fetchJson, makePoint, labelPoint, assertLabeled, probeSource } from './_shared.js';

const OPENSKY_SOURCE = 'OpenSky Network';
const ADSBLOL_SOURCE = 'adsb.lol';
const OPENSKY_STATES = 'https://opensky-network.org/api/states/all';
// adsb.lol v2 point query — nearest receivers around a coordinate.
const ADSBLOL_POINT = (lat, lon) => `https://api.adsb.lol/v2/point/${lat}/${lon}`;

// OpenSky state-vector array layout (API v1, documented field order).
const IDX = Object.freeze({
  ICAO24: 0, CALLSIGN: 1, ORIGIN_COUNTRY: 2, TIME_POSITION: 3, LAST_CONTACT: 4,
  LONGITUDE: 5, LATITUDE: 6, BARO_ALTITUDE: 7, ON_GROUND: 8, VELOCITY: 9,
  TRUE_TRACK: 10, VERTICAL_RATE: 11, SENSORS: 12, GEO_ALTITUDE: 13,
  SQUAWK: 14, SPI: 15, POSITION_SOURCE: 16,
});

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

function fromOpenSky(states, limit) {
  const points = [];
  let droppedNoPosition = 0;
  for (const s of states) {
    if (points.length >= limit) break;
    const lon = s[IDX.LONGITUDE];
    const lat = s[IDX.LATITUDE];
    if (typeof lat !== 'number' || typeof lon !== 'number') {
      droppedNoPosition += 1;
      continue; // state without a live position → no fabricated point
    }
    points.push(labelPoint(makePoint({
      icao24: s[IDX.ICAO24] ?? null,
      callsign: typeof s[IDX.CALLSIGN] === 'string' ? s[IDX.CALLSIGN].trim() : null,
      originCountry: s[IDX.ORIGIN_COUNTRY] ?? null,
      onGround: s[IDX.ON_GROUND] === true,
      baroAltitudeM: typeof s[IDX.BARO_ALTITUDE] === 'number' ? s[IDX.BARO_ALTITUDE] : null,
      velocityMs: typeof s[IDX.VELOCITY] === 'number' ? s[IDX.VELOCITY] : null,
      trueTrackDeg: typeof s[IDX.TRUE_TRACK] === 'number' ? s[IDX.TRUE_TRACK] : null,
      positionSource: s[IDX.POSITION_SOURCE] ?? null,
      lastContactUnix: typeof s[IDX.LAST_CONTACT] === 'number' ? s[IDX.LAST_CONTACT] : null,
    }, { lat, lon }), {
      label: 'observed',
      source: OPENSKY_SOURCE,
      method: 'brokered fetch — OpenSky /api/states/all anonymous state vectors',
      notes: 'registration opensky-states (layer: flights)',
    }));
  }
  return { points, droppedNoPosition };
}

function fromAdsbLol(body) {
  const aircraft = Array.isArray(body?.ac) ? body.ac : [];
  const points = [];
  for (const a of aircraft) {
    if (typeof a.lat !== 'number' || typeof a.lon !== 'number') continue;
    points.push(labelPoint(makePoint({
      icao24: a.hex ?? null,
      callsign: typeof a.flight === 'string' ? a.flight.trim() : a.flight ?? null,
      registration: a.r ?? null,
      type: a.t ?? null,
      onGround: a.alt_baro === 'ground',
      baroAltitudeFt: typeof a.alt_baro === 'number' ? a.alt_baro : null,
      groundSpeedKt: typeof a.gs === 'number' ? a.gs : null,
      trackDeg: typeof a.track === 'number' ? a.track : null,
    }, { lat: a.lat, lon: a.lon }), {
      label: 'observed',
      source: ADSBLOL_SOURCE,
      method: 'brokered fetch — adsb.lol /v2/point/{lat}/{lon} community ADS-B aggregate',
      notes: 'registration adsb-lol (layer: flights)',
    }));
  }
  return points;
}

export default {
  id: 'flights',
  label: 'Flights',
  tier: 0,
  keyless: true,
  source: {
    name: `${OPENSKY_SOURCE} (primary) + ${ADSBLOL_SOURCE} (fallback)`,
    url: 'https://opensky-network.org/',
    license: 'OpenSky data — CC BY-SA 4.0 (anonymous tier); adsb.lol — CC BY-SA 2.0',
  },

  /**
   * Live aircraft state vectors. Primary: OpenSky global states (anonymous).
   * Fallback (only if the primary fails): adsb.lol point query around
   * opts.lat/opts.lon (default Berlin — 52.52 / 13.405; documented sample
   * coordinates used as a QUERY PARAMETER, never presented as invented data).
   * The `limit` cap is a projection of an identity-preserving read: each
   * emitted point keeps its own observed label; nothing is derived.
   * @param {{ limit?: number, lat?: number, lon?: number }} [opts]
   * @returns {Promise<Array<{ lat, lon, icao24, callsign, provenance, ... }>>}
   * @throws LayerError E_LAYER_UNAVAILABLE (both paths failed — reasons listed)
   */
  async fetch(opts = {}) {
    const limit = clamp(Number(opts.limit ?? 100) || 100, 1, 2000);
    const attempts = [];
    try {
      const { body } = await fetchJson(OPENSKY_STATES, { maxBytes: 9_000_000 });
      if (!Array.isArray(body?.states)) {
        throw new LayerError('E_BAD_RESPONSE', 'OpenSky response has no states[] array');
      }
      const { points } = fromOpenSky(body.states, limit);
      return assertLabeled(points);
    } catch (err) {
      attempts.push(`opensky: ${err.code ?? err.name} — ${err.message}`);
    }
    try {
      const lat = Number.isFinite(Number(opts.lat)) ? Number(opts.lat) : 52.52;
      const lon = Number.isFinite(Number(opts.lon)) ? Number(opts.lon) : 13.405;
      const { body } = await fetchJson(ADSBLOL_POINT(lat, lon), { maxBytes: 2_000_000 });
      const points = fromAdsbLol(body).slice(0, limit);
      if (points.length === 0) {
        throw new LayerError('E_BAD_RESPONSE', 'adsb.lol answered but returned no positioned aircraft');
      }
      return assertLabeled(points);
    } catch (err) {
      attempts.push(`adsb.lol: ${err.code ?? err.name} — ${err.message}`);
    }
    throw new LayerError('E_LAYER_UNAVAILABLE', `all flight sources failed — ${attempts.join(' | ')}`);
  },

  /** Real probe: the primary OpenSky endpoint through the trust pipeline. */
  async check() {
    return probeSource(OPENSKY_STATES, { layerId: 'flights', maxBytes: 9_000_000 });
  },
};

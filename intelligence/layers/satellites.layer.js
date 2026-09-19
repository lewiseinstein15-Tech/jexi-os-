/**
 * JEXI OS — Phase 9 Scope I — satellites layer (CelesTrak).
 *
 * Zone: intelligence/layers/**. Transport: Scope A trust pipeline ONLY
 * (registration 'celestrak-gp' — celestrak.org /NORAD/elements/gp.php,
 * keyless, provenance 'observed'). No raw fetch. No simulated points.
 *
 * PROVENANCE DOCTRINE (Scope G rule 4): the GP element set IS observed
 * data, but the ground subpoint this layer EMITS is DERIVED from it by a
 * circular-orbit propagation. Derived values must never carry 'observed' —
 * every emitted point is attachEstimated(...) with required confidence and
 * a notes field naming the derivation and its simplifications.
 *
 * Build-time sandbox status: celestrak.org UNREACHABLE from this sandbox
 * (brokered probe and plain fetch both fail at the transport level).
 * check() re-probes live every call and will report 'ok' the moment
 * egress is available.
 */

import { fetchJson, makePoint, labelPoint, assertLabeled, probeSource } from './_shared.js';

const SOURCE = 'CelesTrak (GP element sets)';
const GP_GROUP = (group) =>
  `https://celestrak.org/NORAD/elements/gp.php?GROUP=${encodeURIComponent(group)}&FORMAT=json`;
const CHECK_URL = 'https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=json';

const MU_KM3_S2 = 398600.4418;   // Earth gravitational parameter
const EARTH_RADIUS_KM = 6371.0;
const TWO_PI = Math.PI * 2;

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const toRad = (deg) => (deg * Math.PI) / 180;

/**
 * Circular-orbit subpoint propagation from a GP element set.
 * Simplifications (declared in every point's provenance notes): Kepler
 * solved for e<0.33 orbits, J2 nodal regression ignored, drag ignored,
 * GMST from the IAU-82 linear model (no nutation/precession terms).
 * @param {object} gp CelesTrak JSON GP record
 * @param {number} nowMs propagation epoch (unix ms)
 * @returns {{ latDeg: number, lonDeg: number, altKm: number }}
 */
export function propagateSubpoint(gp, nowMs) {
  const epochMs = Date.parse(gp.EPOCH);
  const n0 = Number(gp.MEAN_MOTION);
  const e = Number(gp.ECCENTRICITY);
  const inc = toRad(Number(gp.INCLINATION));
  const raan = toRad(Number(gp.RA_OF_ASC_NODE));
  const argp = toRad(Number(gp.ARG_OF_PERICENTER));
  const m0 = toRad(Number(gp.MEAN_ANOMALY));
  if (![epochMs, n0, e, inc, raan, argp, m0].every(Number.isFinite)) {
    throw new Error(`GP record for NORAD ${gp.NORAD_CAT_ID} has a non-numeric orbital element`);
  }
  const nRadSec = (n0 * TWO_PI) / 86400; // rev/day → rad/s

  // Kepler: M = M0 + n·t, solve E - e·sinE = M (Newton-Raphson)
  let M = (m0 + nRadSec * ((nowMs - epochMs) / 1000)) % TWO_PI;
  if (M < 0) M += TWO_PI;
  let E = M;
  for (let k = 0; k < 8; k += 1) {
    E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  }
  const nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));

  // ECEF subpoint from argument of latitude, minus Greenwich sidereal time
  const u = argp + nu;
  const latRad = Math.asin(Math.sin(inc) * Math.sin(u));
  const lonEcef = Math.atan2(Math.sin(u) * Math.cos(inc), Math.cos(u));
  const jd = nowMs / 86400000 + 2440587.5;
  const d = jd - 2451545.0;
  const gmstRad = toRad((280.46061837 + 360.98564736629 * d) % 360);
  const lonRad = raan + lonEcef - gmstRad;

  const aKm = Math.cbrt(MU_KM3_S2 / (nRadSec * nRadSec));
  const altKm = aKm * (1 - e * Math.cos(E)) - EARTH_RADIUS_KM;

  const toLonDeg = (r) => ((r * 180) / Math.PI);
  return {
    latDeg: (latRad * 180) / Math.PI,
    lonDeg: ((toLonDeg(lonRad) + 540) % 360) - 180,
    altKm,
  };
}

export default {
  id: 'satellites',
  label: 'Satellites',
  tier: 0,
  keyless: true,
  source: {
    name: SOURCE,
    url: 'https://celestrak.org/',
    license: 'CelesTrak GP data — free for public use (space catalog data redistribution rules apply)',
  },

  /**
   * Satellite ground subpoints propagated from real CelesTrak GP element
   * sets. Labeled 'estimated' — see the provenance doctrine note above.
   * @param {{ group?: string, limit?: number, nowMs?: number }} [opts]
   * @returns {Promise<Array<{ lat, lon, name, noradId, epoch, altKm, provenance }>>}
   * @throws LayerError E_LAYER_UNAVAILABLE / E_BAD_RESPONSE
   */
  async fetch(opts = {}) {
    const group = String(opts.group ?? 'stations');
    const limit = clamp(Number(opts.limit ?? 10) || 10, 1, 100);
    const nowMs = Number.isFinite(Number(opts.nowMs)) ? Number(opts.nowMs) : Date.now();
    const { body } = await fetchJson(GP_GROUP(group), { maxBytes: 8_000_000 });
    if (!Array.isArray(body)) {
      throw new LayerError('E_BAD_RESPONSE', 'CelesTrak GP response is not a JSON array');
    }
    const points = [];
    for (const gp of body) {
      if (points.length >= limit) break;
      if (!gp?.OBJECT_NAME || !gp?.NORAD_CAT_ID || !gp?.EPOCH) continue;
      let sub;
      try {
        sub = propagateSubpoint(gp, nowMs);
      } catch {
        continue; // malformed element set → skip it, never invent it
      }
      points.push(labelPoint(makePoint({
        name: gp.OBJECT_NAME,
        noradId: gp.NORAD_CAT_ID,
        epoch: gp.EPOCH,
        altKm: Math.round(sub.altKm * 10) / 10,
        objectType: gp.OBJECT_TYPE ?? null,
      }, { lat: sub.latDeg, lon: sub.lonDeg }), {
        label: 'estimated',
        source: SOURCE,
        method: `circular-orbit subpoint propagation over GP element set (NORAD ${gp.NORAD_CAT_ID}); J2/drag ignored, IAU-82 GMST`,
        confidence: 0.6,
        notes: `derived from the observed element set for ${gp.OBJECT_NAME} — the subpoint is computed, not directly measured`,
      }));
    }
    if (points.length === 0) {
      throw new LayerError('E_BAD_RESPONSE', `no usable GP records in group '${group}'`);
    }
    return assertLabeled(points);
  },

  /** Real probe: single-record (ISS, CATNR 25544) GP fetch through the pipeline. */
  async check() {
    return probeSource(CHECK_URL, { layerId: 'satellites', maxBytes: 200_000 });
  },
};

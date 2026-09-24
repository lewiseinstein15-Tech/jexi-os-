/**
 * JEXI OS — Phase 9 Scope I — astronomy layer (NASA APOD + sky data).
 *
 * Zone: intelligence/layers/**. Transport: Scope A trust pipeline ONLY.
 *
 * Two honest parts:
 *  1. NASA APOD (api.nasa.gov, api_key=DEMO_KEY — the public shared demo
 *     key, no registration needed): UNREGISTERED in the trust pipeline,
 *     so the broker refuses with E_UNREGISTERED_HOST. ZONE-OWNER TASK:
 *     register api.nasa.gov (/planetary/) for layer 'astronomy'. Until
 *     then APOD data is honestly unavailable — never faked.
 *  2. The subsolar point (where the Sun is directly overhead right now):
 *     real solar-geometry derivation from the real system clock using the
 *     NOAA solar calculator formulas (declination + equation of time).
 *     This needs NO network and NO source credential — but it is DERIVED,
 *     so every point carries label 'estimated' with required confidence
 *     (Scope G rule 3/4). It is never presented as an observation.
 */

import { fetchJson, makePoint, labelPoint, assertLabeled, probeSource, LayerError } from './_shared.js';

const APOD_SOURCE = 'NASA APOD (Astronomy Picture of the Day)';
const APOD = 'https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY';
const DERIVED_SOURCE = 'JEXI astronomy math (NOAA solar calculator formulas) over the real system clock';

const TWO_PI = Math.PI * 2;

/**
 * Subsolar point at a given instant (NOAA solar calculator approximation:
 * fractional-year solar declination + equation of time). Accuracy is
 * sub-degree for decades around J2000 — declared via confidence 0.9 on
 * the emitted points and the method string.
 * @param {number} nowMs unix ms
 * @returns {{ latDeg: number, lonDeg: number, declinationDeg: number, eqOfTimeMin: number }}
 */
export function subsolarPoint(nowMs) {
  const d = new Date(nowMs);
  const startOfYear = Date.UTC(d.getUTCFullYear(), 0, 1);
  const dayOfYear = (nowMs - startOfYear) / 86400000;
  const gamma = (TWO_PI / 365) * (dayOfYear - 1 + (d.getUTCHours() - 12) / 24);
  const eqTimeMin =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));
  const declDeg =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);
  const declinationDeg = declDeg * (180 / Math.PI);
  // Solar noon (UTC minutes) = 720 - 4*lon - eqTime  →  lon = (720 - eqTime - utcMinutes)/4
  const utcMinutes = d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60;
  let lonDeg = (720 - eqTimeMin - utcMinutes) / 4;
  lonDeg = ((lonDeg + 540) % 360) - 180;
  return { latDeg: declinationDeg, lonDeg, declinationDeg, eqOfTimeMin: eqTimeMin };
}

export default {
  id: 'astronomy',
  label: 'Astronomy',
  tier: 0,
  keyless: true, // APOD's DEMO_KEY is a public shared key; the subsolar derivation needs nothing at all
  source: {
    name: `${APOD_SOURCE} + derived solar geometry`,
    url: 'https://api.nasa.gov/',
    license: 'NASA content — public domain (non-endorsement rules apply)',
  },

  /**
   * @param {{ includeApod?: boolean, nowMs?: number }} [opts]
   * @returns {Promise<Array<{ lat, lon, kind, ...data, provenance }>>}
   *   - kind 'subsolar' → 'estimated' (derived solar geometry)
   *   - kind 'apod'     → the APOD record itself carries NO coordinates and
   *     is therefore NEVER emitted as a positioned point; when reachable it
   *     is fetched (proving the path) and its metadata is attached to the
   *     subsolar point's `apodOfToday` field, keeping the provenance honest.
   * @throws LayerError E_LAYER_UNAVAILABLE only when opts.includeApod is
   *   explicitly true and APOD is unreachable; the default subsolar
   *   derivation always works offline.
   */
  async fetch(opts = {}) {
    const nowMs = Number.isFinite(Number(opts.nowMs)) ? Number(opts.nowMs) : Date.now();
    const sub = subsolarPoint(nowMs);

    let apodMeta = null;
    if (opts.includeApod === true) {
      try {
        const { body } = await fetchJson(APOD, { maxBytes: 500_000 });
        apodMeta = {
          date: body?.date ?? null,
          title: body?.title ?? null,
          mediaType: body?.media_type ?? null,
          serviceVersion: body?.service_version ?? null,
        };
      } catch (err) {
        if (opts.apodRequired === true && err instanceof LayerError) throw err;
        apodMeta = { error: `${err.code}: ${err.message}` };
      }
    }

    const point = labelPoint(makePoint({
      kind: 'subsolar',
      at: new Date(nowMs).toISOString(),
      declinationDeg: Math.round(sub.declinationDeg * 1000) / 1000,
      eqOfTimeMin: Math.round(sub.eqOfTimeMin * 1000) / 1000,
      ...(apodMeta ? { apodOfToday: apodMeta } : {}),
    }, { lat: sub.latDeg, lon: sub.lonDeg }), {
      label: 'estimated',
      source: DERIVED_SOURCE,
      method: 'subsolar point from NOAA solar geometry (fractional-year declination + equation of time)',
      confidence: 0.9,
      notes: 'derived from the real system clock — solar position is computed, not measured by a remote source',
    });

    return assertLabeled([point]);
  },

  /** Real probe: APOD through the pipeline — honestly 'unregistered' today. */
  async check() {
    const verdict = await probeSource(APOD, { layerId: 'astronomy', maxBytes: 200_000 });
    if (verdict.status === 'ok') return verdict;
    return {
      ...verdict,
      message: `${verdict.message} (offline-derived subsolar points remain available via fetch() regardless)`,
    };
  },
};

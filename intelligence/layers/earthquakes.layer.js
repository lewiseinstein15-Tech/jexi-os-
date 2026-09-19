/**
 * JEXI OS — Phase 9 Scope I — earthquakes layer (USGS).
 *
 * Zone: intelligence/layers/**. Transport: Scope A trust pipeline ONLY
 * (registration 'usgs-summary' — earthquake.usgs.gov, keyless, provenance
 * 'observed'). No raw fetch. No simulated points.
 *
 * Build-time sandbox status: VERIFIED REACHABLE (brokered HTTP 200).
 * check() re-probes live every call.
 */

import { fetchJson, makePoint, labelPoint, assertLabeled, probeSource } from './_shared.js';

const SOURCE = 'USGS Earthquake Hazards Program';
const FDSN_QUERY = 'https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&limit=';
const CHECK_URL = 'https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&limit=1';

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

export default {
  id: 'earthquakes',
  label: 'Earthquakes',
  tier: 0,
  keyless: true,
  source: {
    name: SOURCE,
    url: 'https://earthquake.usgs.gov/',
    license: 'USGS — public domain (U.S. Government work, no usage restrictions)',
  },

  /**
   * Real earthquake events from the USGS FDSN event service.
   * @param {{ limit?: number }} [opts]
   * @returns {Promise<Array<{ lat, lon, eventId, mag, place, time, depthKm, eventUrl, provenance }>>}
   * @throws LayerError E_LAYER_UNAVAILABLE / E_BAD_RESPONSE
   */
  async fetch(opts = {}) {
    const limit = clamp(Number(opts.limit ?? 50) || 50, 1, 500);
    const { body } = await fetchJson(`${FDSN_QUERY}${limit}`, { maxBytes: 4_000_000 });
    if (!Array.isArray(body?.features)) {
      throw new LayerError('E_BAD_RESPONSE', 'USGS geojson has no features[] array');
    }
    const points = [];
    for (const f of body.features) {
      const coords = f?.geometry?.coordinates;
      if (!Array.isArray(coords) || coords.length < 2) continue; // no position → no fabricated point
      const [lon, lat, depthKm] = coords;
      points.push(labelPoint(makePoint({
        eventId: f.id,
        mag: f.properties?.mag ?? null,
        place: f.properties?.place ?? null,
        time: typeof f.properties?.time === 'number' ? new Date(f.properties.time).toISOString() : null,
        depthKm: depthKm ?? null,
        eventUrl: f.properties?.url ?? null,
      }, { lat, lon }), {
        label: 'observed',
        source: SOURCE,
        method: 'brokered fetch — USGS FDSN event query (format=geojson)',
        notes: 'registration usgs-summary (layer: earthquakes)',
      }));
    }
    return assertLabeled(points);
  },

  /** Real probe: one-record FDSN query through the trust pipeline. */
  async check() {
    return probeSource(CHECK_URL, { layerId: 'earthquakes', maxBytes: 200_000 });
  },
};

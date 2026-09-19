/**
 * JEXI OS — Phase 9 Scope I — marine layer (tides / water levels).
 *
 * Zone: intelligence/layers/**. Transport: Scope A trust pipeline ONLY.
 *
 * HONEST ABSENCE: NOAA Tides & Currents (CO-OPS) is fully keyless, but
 * api.tidesandcurrents.noaa.gov has NO registration in the trust pipeline
 * (the Scope A registry has no 'marine' HTTP entry — only the deliberate
 * AISStream WSS note). Fetches are refused by the broker with
 * E_UNREGISTERED_HOST and surfaced as E_LAYER_UNAVAILABLE. ZONE-OWNER
 * TASK: register api.tidesandcurrents.noaa.gov (/mdapi/prod/webapi/) for
 * layer 'marine'. This scope must not modify intelligence/trust-pipeline/**.
 */

import { fetchJson, makePoint, labelPoint, assertLabeled, probeSource, LayerError } from './_shared.js';

const SOURCE = 'NOAA Tides & Currents (CO-OPS Metadata API)';
const STATIONS = 'https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=waterlevels';

export default {
  id: 'marine',
  label: 'Marine / Tides',
  tier: 0,
  keyless: true,
  source: {
    name: SOURCE,
    url: 'https://api.tidesandcurrents.noaa.gov/',
    license: 'U.S. Government work — public domain (NOAA data)',
  },

  /**
   * Real water-level tide stations with their coordinates.
   * @param {{ limit?: number }} [opts]
   * @throws LayerError E_LAYER_UNAVAILABLE (cause: E_UNREGISTERED_HOST —
   *   zone-owner registration task) until the host is registered.
   */
  async fetch(opts = {}) {
    const limit = Number(opts.limit ?? 30) || 30;
    let body;
    try {
      ({ body } = await fetchJson(STATIONS, { maxBytes: 4_000_000 }));
    } catch (err) {
      if (err instanceof LayerError && err.cause?.code === 'E_UNREGISTERED_HOST') {
        throw new LayerError(
          'E_LAYER_UNAVAILABLE',
          `${err.message} — marine layer is implemented but its host has no trust-pipeline registration; ` +
            `zone-owner task: register api.tidesandcurrents.noaa.gov (/mdapi/prod/webapi/) for layer 'marine'`,
          { cause: err.cause },
        );
      }
      throw err;
    }
    if (!Array.isArray(body?.stations)) {
      throw new LayerError('E_BAD_RESPONSE', 'CO-OPS response has no stations[] array');
    }
    const points = [];
    for (const s of body.stations) {
      const lat = typeof s.lat === 'number' ? s.lat : Number(s.lat);
      const lon = typeof s.lng === 'number' ? s.lng : Number(s.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue; // unpositioned station → never invented
      points.push(labelPoint(makePoint({
        stationId: s.id ?? null,
        name: s.name ?? null,
        state: s.state ?? null,
        timezone: s.timezone ?? null,
        depthType: s.depthType ?? null,
      }, { lat, lon }), {
        label: 'observed',
        source: SOURCE,
        method: 'brokered fetch — CO-OPS /mdapi stations.json?type=waterlevels station registry',
        notes: "registration (zone-owner task: api.tidesandcurrents.noaa.gov for layer 'marine')",
      }));
      if (points.length >= limit) break;
    }
    if (points.length === 0) {
      throw new LayerError('E_BAD_RESPONSE', 'CO-OPS answered but contained no positioned stations');
    }
    return assertLabeled(points);
  },

  /** Real probe: the stations registry, honestly 'unregistered' today. */
  async check() {
    return probeSource(STATIONS, { layerId: 'marine', maxBytes: 200_000 });
  },
};

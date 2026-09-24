/**
 * JEXI OS — Phase 9 Scope I — bikeshare layer (GBFS / NABSA).
 *
 * Zone: intelligence/layers/**. Transport: Scope A trust pipeline ONLY
 * (registration 'gbfs-systems' — gbfs.github.io/gbfs/, keyless, provenance
 * 'observed'). No raw fetch. No simulated points.
 *
 * Build-time sandbox status: the registered endpoint answers HTTP 404 —
 * NABSA has relocated its systems index since the registration was written.
 * The layer code is real and will fetch the moment the registration points
 * at a live path. check() re-probes live and reports the 404 honestly
 * (zone-owner task: re-register the current index host).
 */

import { brokerFetch, makePoint, labelPoint, assertLabeled, probeSource, parseCsvRows, LayerError } from './_shared.js';

const SOURCE = 'GBFS (General Bikeshare Feed Specification, NABSA)';
const SYSTEMS_CSV = 'https://gbfs.github.io/gbfs/systems.csv';

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

export default {
  id: 'bikeshare',
  label: 'Bikeshare Systems',
  tier: 0,
  keyless: true,
  source: {
    name: SOURCE,
    url: 'https://github.com/NABSA/gbfs',
    license: 'Systems index — open data; individual operator feeds carry their own terms',
  },

  /**
   * Real bike-share system locations from the NABSA systems index.
   * The index CSV carries a "Location" column of "lat, lon" pairs.
   * @param {{ limit?: number }} [opts]
   * @returns {Promise<Array<{ lat, lon, name, country, city, provenance }>>}
   * @throws LayerError E_LAYER_UNAVAILABLE / E_BAD_RESPONSE
   */
  async fetch(opts = {}) {
    const limit = clamp(Number(opts.limit ?? 50) || 50, 1, 1000);
    const result = await brokerFetch(SYSTEMS_CSV, { maxBytes: 2_000_000 });
    if (!result.ok) {
      // e.g. HTTP 404 — NABSA relocated the index; reported with the specific code
      throw new LayerError('E_LAYER_UNAVAILABLE', `source unavailable: ${result.error.code} — ${result.error.message} (requested ${SYSTEMS_CSV})`, { cause: result.error });
    }
    {
      const rows = parseCsvRows(result.text);
      if (rows.length < 2) {
        throw new LayerError('E_BAD_RESPONSE', 'GBFS systems CSV has no data rows');
      }
      const header = rows[0].map((h) => h.toLowerCase());
      const nameIdx = header.indexOf('name');
      const countryIdx = header.indexOf('country');
      const cityIdx = header.indexOf('city');
      const locIdx = header.findIndex((h) => h === 'location' || h === 'location (lat, lon)');
      if (locIdx === -1 || nameIdx === -1) {
        throw new LayerError('E_BAD_RESPONSE', 'GBFS systems CSV lacks name/location columns');
      }
      const points = [];
      for (const row of rows.slice(1)) {
        const loc = String(row[locIdx] ?? '').split(';').map((s) => s.trim()).filter(Boolean);
        for (const pair of loc) {
          const [latS, lonS] = pair.split(',').map((s) => s.trim());
          const lat = Number(latS);
          const lon = Number(lonS);
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue; // unparseable pair → never invented
          points.push(labelPoint(makePoint({
            name: row[nameIdx] ?? null,
            country: countryIdx !== -1 ? row[countryIdx] : null,
            city: cityIdx !== -1 ? row[cityIdx] : null,
          }, { lat, lon }), {
            label: 'observed',
            source: SOURCE,
            method: 'brokered fetch — GBFS systems index CSV (operator-published locations)',
            notes: 'registration gbfs-systems (layer: bikeshare)',
          }));
          if (points.length >= limit) return assertLabeled(points);
        }
      }
      if (points.length === 0) {
        throw new LayerError('E_BAD_RESPONSE', 'GBFS systems CSV parsed but contained no positioned systems');
      }
      return assertLabeled(points);
    }
  },

  /** Real probe: the registered systems index through the trust pipeline. */
  async check() {
    return probeSource(SYSTEMS_CSV, { layerId: 'bikeshare', maxBytes: 200_000 });
  },
};

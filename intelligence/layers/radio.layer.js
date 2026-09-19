/**
 * JEXI OS — Phase 9 Scope I — radio layer (Radio Browser).
 *
 * Zone: intelligence/layers/**. Transport: Scope A trust pipeline ONLY
 * (registrations 'radio-browser-de1'/'radio-browser-de2' — keyless,
 * provenance 'observed'). No raw fetch. No simulated points.
 *
 * Build-time sandbox status: de1 VERIFIED REACHABLE (brokered HTTP 200);
 * de2 unreachable from this sandbox. check() re-probes live every call.
 */

import { fetchJson, makePoint, labelPoint, assertLabeled, probeSource, normalizeLat, normalizeLon } from './_shared.js';

const SOURCE = 'Radio Browser (community radio station directory)';
const SEARCH = (mirror, limit) =>
  `https://${mirror}.api.radio-browser.info/json/stations/search?has_geo_info=true&limit=${limit}&order=clickcount&reverse=true`;
const MIRRORS = ['de1', 'de2'];

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

function toStationPoint(station) {
  // has_geo_info=true still admits stations with null/0 coordinates —
  // (0, 0) in the Gulf of Guinea is a known sentinel, not a station site.
  const lat = typeof station.geo_lat === 'number' ? station.geo_lat : Number(station.geo_lat);
  const lon = typeof station.geo_long === 'number' ? station.geo_long : Number(station.geo_long);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat === 0 && lon === 0) return null;
  return makePoint({
    stationuuid: station.stationuuid ?? null,
    name: station.name ?? null,
    country: station.country ?? null,
    tags: station.tags ?? null,
    homepage: station.homepage ?? null,
    codec: station.codec ?? null,
    bitrateKbps: station.bitrate ?? null,
  }, { lat, lon });
}

export default {
  id: 'radio',
  label: 'Radio Stations',
  tier: 0,
  keyless: true,
  source: {
    name: SOURCE,
    url: 'https://www.radio-browser.info/',
    license: 'ODbL / CC-BY — community database (attribution + share-alike per docs)',
  },

  /**
   * Real geo-located radio stations from the community directory.
   * @param {{ limit?: number, mirror?: 'de1'|'de2' }} [opts]
   * @returns {Promise<Array<{ lat, lon, stationuuid, name, country, tags, homepage, codec, bitrateKbps, provenance }>>}
   * @throws LayerError E_LAYER_UNAVAILABLE (every mirror tried, with per-mirror reasons)
   */
  async fetch(opts = {}) {
    const limit = clamp(Number(opts.limit ?? 10) || 10, 1, 100);
    const mirrors = opts.mirror ? [String(opts.mirror)] : MIRRORS;
    const attempts = [];
    for (const mirror of mirrors) {
      try {
        const { body } = await fetchJson(SEARCH(mirror, limit), { maxBytes: 2_000_000 });
        if (!Array.isArray(body)) {
          throw new LayerError('E_BAD_RESPONSE', `mirror ${mirror}: response is not a JSON array`);
        }
        const points = [];
        for (const s of body) {
          const data = toStationPoint(s);
          if (!data) continue; // no usable position → no fabricated point
          points.push(labelPoint(data, {
            label: 'observed',
            source: SOURCE,
            method: `brokered fetch — /json/stations/search (has_geo_info=true) via mirror ${mirror}`,
            notes: `registration radio-browser-${mirror} (layer: radio)`,
          }));
        }
        return assertLabeled(points);
      } catch (err) {
        attempts.push(`mirror ${mirror}: ${err.code ?? err.name} — ${err.message}`);
      }
    }
    const e = new LayerError('E_LAYER_UNAVAILABLE', `all Radio Browser mirrors failed — ${attempts.join(' | ')}`);
    throw e;
  },

  /**
   * Real probe: one-record search through the trust pipeline. Tries de1
   * then de2 and reports the first mirror that actually answers.
   */
  async check() {
    const attempts = [];
    for (const mirror of MIRRORS) {
      const verdict = await probeSource(SEARCH(mirror, 1), { layerId: 'radio', maxBytes: 100_000 });
      if (verdict.status === 'ok') return verdict;
      attempts.push(`${mirror}: ${verdict.status} (${verdict.message})`);
    }
    return { status: 'unavailable', message: `all mirrors probed — ${attempts.join(' | ')}` };
  },
};

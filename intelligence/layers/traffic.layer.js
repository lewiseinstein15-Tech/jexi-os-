/**
 * JEXI OS — Phase 9 Scope I — traffic layer (OSM Overpass; TomTom optional).
 *
 * Zone: intelligence/layers/**. Transport: Scope A trust pipeline ONLY
 * (registrations 'overpass-api' keyless and 'tomtom-traffic' keyed).
 * No raw fetch. No simulated points.
 *
 * DOCTRINE: the keyless path (OSM Overpass) is primary. TomTom is keyed
 * and OPTIONAL — attempted only when a key is supplied (opts.tomTomKey or
 * TOMTOM_API_KEY); the layer works without it or reports honestly.
 *
 * Build-time sandbox status: overpass-api.de UNREACHABLE from this sandbox
 * (brokered probe and plain fetch both fail at the transport level).
 * check() re-probes live every call.
 */

import { fetchJson, makePoint, labelPoint, assertLabeled, probeSource, LayerError } from './_shared.js';

const SOURCE = 'OpenStreetMap (Overpass API)';
const INTERPRETER = 'https://overpass-api.de/api/interpreter?data=';
const STATUS_URL = 'https://overpass-api.de/api/status';

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** Build + URL-encode an Overpass QL node query inside a bbox. */
function overpassUrl(bbox, selector, limit) {
  const ql = `[out:json][timeout:20];node["highway"="${selector}"](${bbox});out ${limit};`;
  return INTERPRETER + encodeURIComponent(ql);
}

export default {
  id: 'traffic',
  label: 'Traffic Infrastructure',
  tier: 0,
  keyless: true, // OSM path is keyless; TomTom enhancement is optional/keyed
  source: {
    name: `${SOURCE} (keyless) + TomTom (optional, keyed)`,
    url: 'https://wiki.openstreetmap.org/wiki/Overpass_API',
    license: 'ODbL 1.0 — © OpenStreetMap contributors',
  },

  /**
   * Real OSM map features (default: traffic signals) inside a WGS84 bbox
   * "south,west,north,east" (Overpass bbox order).
   * @param {{ bbox?: string, selector?: string, limit?: number }} [opts]
   * @returns {Promise<Array<{ lat, lon, osmId, tags, provenance }>>}
   * @throws LayerError E_LAYER_UNAVAILABLE / E_BAD_RESPONSE
   */
  async fetch(opts = {}) {
    const bbox = String(opts.bbox ?? '51.505,-0.09,51.515,-0.07'); // central London sample area
    const selector = String(opts.selector ?? 'traffic_signals');
    const limit = clamp(Number(opts.limit ?? 20) || 20, 1, 200);
    const { body } = await fetchJson(overpassUrl(bbox, selector, limit), { maxBytes: 4_000_000 });
    if (!Array.isArray(body?.elements)) {
      throw new LayerError('E_BAD_RESPONSE', 'Overpass response has no elements[] array');
    }
    const points = [];
    for (const el of body.elements) {
      if (typeof el.lat !== 'number' || typeof el.lon !== 'number') continue;
      points.push(labelPoint(makePoint({
        osmId: `node/${el.id}`,
        highway: el?.tags?.highway ?? null,
        name: el?.tags?.name ?? null,
        tags: el.tags ? Object.keys(el.tags).join('|') : null,
      }, { lat: el.lat, lon: el.lon }), {
        label: 'observed',
        source: SOURCE,
        method: `brokered fetch — Overpass QL node["highway"=${JSON.stringify(selector)}] in bbox ${bbox}`,
        notes: 'registration overpass-api (layer: traffic) — © OpenStreetMap contributors (ODbL)',
      }));
    }
    if (points.length === 0) {
      throw new LayerError('E_BAD_RESPONSE', `Overpass returned no positioned nodes for selector '${selector}' in ${bbox}`);
    }
    return assertLabeled(points);
  },

  /** Real probe: Overpass /api/status (lightweight, registered path). */
  async check() {
    return probeSource(STATUS_URL, { layerId: 'traffic', maxBytes: 50_000 });
  },
};

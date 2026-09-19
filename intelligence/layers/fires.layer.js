/**
 * JEXI OS — Phase 9 Scope I — fires layer (NASA FIRMS).
 *
 * Zone: intelligence/layers/**. Transport: Scope A trust pipeline ONLY
 * (registration 'nasa-firms' — firms.modaps.eosdis.nasa.gov, provenance
 * 'observed'). No raw fetch. No simulated points.
 *
 * KEYLESS DOCTRINE: the registration note is explicit — "MAP_KEY required
 * for the area API; static archive is keyless". The PRIMARY path below is
 * the keyless static archive: /data/active_fire/ (product) /csv/ files,
 * i.e. SUOMI_VIIRS_C2_Global_24h.csv and MODIS_C6_1_Global_24h.csv.
 * The keyed area API (/api/area/csv/) is the SECONDARY path, used only
 * when an operator supplies a MAP_KEY via opts.mapKey or FIRMS_MAP_KEY.
 *
 * Build-time sandbox status: firms.modaps.eosdis.nasa.gov UNREACHABLE
 * from this sandbox (brokered probe and plain fetch both fail at the
 * transport level). check() re-probes live every call.
 */

import { brokerFetch, makePoint, labelPoint, assertLabeled, probeSource, parseCsvRows, LayerError } from './_shared.js';

const SOURCE = 'NASA FIRMS (Fire Information for Resource Management System)';
const ARCHIVE_CSV = (product, file) =>
  `https://firms.modaps.eosdis.nasa.gov/data/active_fire/${product}/csv/${file}`;
const CHECK_URL = 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/';

// keyless archive product → CSV file name (global 24h active-fire detections)
const KEYLESS_PRODUCTS = Object.freeze({
  'suomi-npp-viirs-c2': 'SUOMI_VIIRS_C2_Global_24h.csv',
  'modis-c6.1': 'MODIS_C6_1_Global_24h.csv',
});

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

function pointsFromCsv(text, product) {
  const rows = parseCsvRows(text);
  if (rows.length < 2) {
    throw new LayerError('E_BAD_RESPONSE', `FIRMS archive CSV for ${product} has no data rows`);
  }
  const header = rows[0].map((h) => h.toLowerCase());
  const latIdx = header.indexOf('latitude');
  const lonIdx = header.indexOf('longitude');
  const dateIdx = header.indexOf('acq_date');
  const timeIdx = header.indexOf('acq_time');
  const confIdx = header.indexOf('confidence');
  const satIdx = header.indexOf('satellite');
  const dayIdx = header.indexOf('daynight');
  if (latIdx === -1 || lonIdx === -1) {
    throw new LayerError('E_BAD_RESPONSE', `FIRMS archive CSV for ${product} lacks latitude/longitude columns`);
  }
  const points = [];
  for (const row of rows.slice(1)) {
    const lat = Number(row[latIdx]);
    const lon = Number(row[lonIdx]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue; // malformed row → never invented
    const acqTime = String(row[timeIdx] ?? '').padStart(4, '0');
    const acqAt = row[dateIdx] && row[dateIdx] !== ''
      ? `${row[dateIdx]}T${acqTime.slice(0, 2)}:${acqTime.slice(2)}:00Z`
      : null;
    points.push(labelPoint(makePoint({
      acquisitionAt: acqAt,
      confidence: row[confIdx] ?? null,
      satellite: row[satIdx] ?? null,
      dayNight: row[dayIdx] ?? null,
      product,
    }, { lat, lon }), {
      label: 'observed',
      source: SOURCE,
      method: 'brokered fetch — keyless FIRMS static archive CSV (active-fire detections)',
      notes: 'registration nasa-firms (layer: fires) — keyless /data/active_fire/ archive path',
    }));
  }
  return points;
}

export default {
  id: 'fires',
  label: 'Fire Detections',
  tier: 0,
  keyless: true, // keyless static archive is the primary path (registry note)
  source: {
    name: SOURCE,
    url: 'https://firms.modaps.eosdis.nasa.gov/',
    license: 'NASA Earth science data — open, attribution requested (FIRMS use policy)',
  },

  /**
   * Real active-fire detections. Primary: keyless global 24h archive CSV.
   * Fallback (only with a MAP_KEY): the /api/area/csv/ keyed API.
   * @param {{ product?: 'suomi-npp-viirs-c2'|'modis-c6.1', mapKey?: string,
   *           limit?: number }} [opts]
   * @returns {Promise<Array<{ lat, lon, acquisitionAt, confidence, satellite, dayNight, provenance }>>}
   * @throws LayerError E_LAYER_UNAVAILABLE / E_MISSING_KEY / E_BAD_RESPONSE
   */
  async fetch(opts = {}) {
    const product = KEYLESS_PRODUCTS[opts.product] ? String(opts.product) : 'suomi-npp-viirs-c2';
    const limit = clamp(Number(opts.limit ?? 200) || 200, 1, 5000);
    const attempts = [];

    try {
      const result = await brokerFetch(ARCHIVE_CSV(product, KEYLESS_PRODUCTS[product]), { maxBytes: 4_000_000 });
      if (!result.ok) throw new LayerError('E_LAYER_UNAVAILABLE', `archive: ${result.error.code} — ${result.error.message}`);
      const points = pointsFromCsv(result.text, product).slice(0, limit);
      if (points.length === 0) {
        throw new LayerError('E_BAD_RESPONSE', `archive CSV for ${product} parsed but contained no positioned detections`);
      }
      return assertLabeled(points);
    } catch (err) {
      attempts.push(`keyless archive: ${err.code ?? err.name} — ${err.message}`);
    }

    // Keyed area API — only attempted when a MAP_KEY actually exists.
    const mapKey = opts.mapKey ?? process.env.FIRMS_MAP_KEY;
    if (!mapKey) {
      throw new LayerError(
        'E_LAYER_UNAVAILABLE',
        `${attempts.join(' | ')} — no FIRMS MAP_KEY configured (set opts.mapKey or FIRMS_MAP_KEY to try the keyed /api/area/csv/ path)`,
        { cause: { code: 'E_MISSING_KEY' } },
      );
    }
    try {
      const west = Number.isFinite(Number(opts.west)) ? Number(opts.west) : -180;
      const south = Number.isFinite(Number(opts.south)) ? Number(opts.south) : -90;
      const east = Number.isFinite(Number(opts.east)) ? Number(opts.east) : 180;
      const north = Number.isFinite(Number(opts.north)) ? Number(opts.north) : 90;
      const areaUrl = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(mapKey)}/VIIRS_SNPP_NRT/${west},${south},${east},${north}/1`;
      const result = await brokerFetch(areaUrl, { maxBytes: 4_000_000 });
      if (!result.ok) throw new LayerError('E_LAYER_UNAVAILABLE', `area api: ${result.error.code} — ${result.error.message}`);
      const points = pointsFromCsv(result.text, 'VIIRS_SNPP_NRT').slice(0, limit);
      return assertLabeled(points);
    } catch (err) {
      attempts.push(`keyed area api: ${err.code ?? err.name} — ${err.message}`);
    }
    throw new LayerError('E_LAYER_UNAVAILABLE', `all FIRMS paths failed — ${attempts.join(' | ')}`);
  },

  /** Real probe: the keyless archive directory through the trust pipeline. */
  async check() {
    const primary = await probeSource(CHECK_URL, { layerId: 'fires', maxBytes: 200_000 });
    if (primary.status === 'ok') return primary;
    const keyed = !optsNoKey();
    return {
      status: primary.status,
      message: `${primary.message}${keyed ? '' : ' — no FIRMS MAP_KEY configured for the keyed /api/area/csv/ fallback either'}`,
    };
  },
};

function optsNoKey() {
  return !process.env.FIRMS_MAP_KEY;
}

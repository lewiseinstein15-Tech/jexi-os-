/**
 * JEXI OS — Phase 9 Scope I — weather layer (Open-Meteo).
 *
 * Zone: intelligence/layers/**. Transport: Scope A trust pipeline ONLY.
 *
 * HONEST ABSENCE: Open-Meteo is fully keyless, but api.open-meteo.com has
 * NO registration in the trust pipeline (the Scope A registry predates
 * this layer and serves no 'weather' entry). Fetches are refused by the
 * broker with E_UNREGISTERED_HOST and surfaced as E_LAYER_UNAVAILABLE.
 * ZONE-OWNER TASK: register api.open-meteo.com (/v1/forecast) for layer
 * 'weather'. This scope must not modify intelligence/trust-pipeline/**.
 */

import { fetchJson, makePoint, labelPoint, assertLabeled, probeSource, LayerError } from './_shared.js';

const SOURCE = 'Open-Meteo (open-source weather API, no key required)';
const FORECAST = 'https://api.open-meteo.com/v1/forecast';

// Documented sample sites — real reference coordinates used as REQUEST
// PARAMETERS (where to ask for a measurement), never presented as
// invented observations. Overridable via opts.locations.
const DEFAULT_LOCATIONS = Object.freeze([
  Object.freeze({ name: 'Berlin', lat: 52.52, lon: 13.405 }),
  Object.freeze({ name: 'Nairobi', lat: -1.286, lon: 36.817 }),
  Object.freeze({ name: 'San Francisco', lat: 37.7749, lon: -122.4194 }),
  Object.freeze({ name: 'Sydney', lat: -33.8688, lon: 151.2093 }),
]);

export default {
  id: 'weather',
  label: 'Weather',
  tier: 0,
  keyless: true,
  source: {
    name: SOURCE,
    url: 'https://open-meteo.com/',
    license: 'Open-Meteo — CC BY 4.0 (attribution required), free non-commercial API',
  },

  /**
   * Real current conditions at the requested (or default sample) sites.
   * @param {{ locations?: Array<{ name?: string, lat: number, lon: number }> }} [opts]
   * @returns {Promise<Array<{ lat, lon, site, temperatureC, windSpeedKmh, observedAt, provenance }>>}
   * @throws LayerError E_LAYER_UNAVAILABLE (cause: E_UNREGISTERED_HOST —
   *   zone-owner registration task) until the host is registered.
   */
  async fetch(opts = {}) {
    const sites = Array.isArray(opts.locations) && opts.locations.length > 0
      ? opts.locations
      : [...DEFAULT_LOCATIONS];
    const lats = sites.map((s) => encodeURIComponent(s.lat)).join(',');
    const lons = sites.map((s) => encodeURIComponent(s.lon)).join(',');
    const url = `${FORECAST}?latitude=${lats}&longitude=${lons}&current=temperature_2m,wind_speed_10m`;
    let body;
    try {
      ({ body } = await fetchJson(url, { maxBytes: 2_000_000 }));
    } catch (err) {
      if (err instanceof LayerError && err.cause?.code === 'E_UNREGISTERED_HOST') {
        throw new LayerError(
          'E_LAYER_UNAVAILABLE',
          `${err.message} — weather layer is implemented but its host has no trust-pipeline registration; ` +
            `zone-owner task: register api.open-meteo.com (/v1/forecast) for layer 'weather'`,
          { cause: err.cause },
        );
      }
      throw err;
    }
    // Open-Meteo returns an object for one location, an array for many.
    const results = Array.isArray(body) ? body : [body];
    const points = [];
    for (let i = 0; i < results.length; i += 1) {
      const r = results[i];
      const lat = r?.latitude;
      const lon = r?.longitude;
      if (typeof lat !== 'number' || typeof lon !== 'number') continue;
      points.push(labelPoint(makePoint({
        site: sites[i]?.name ?? null,
        temperatureC: r?.current?.temperature_2m ?? null,
        windSpeedKmh: r?.current?.wind_speed_10m ?? null,
        observedAt: r?.current?.time ?? null,
        elevationM: typeof r?.elevation === 'number' ? r.elevation : null,
      }, { lat, lon }), {
        label: 'observed',
        source: SOURCE,
        method: 'brokered fetch — Open-Meteo /v1/forecast current=temperature_2m,wind_speed_10m',
        notes: "registration (zone-owner task: api.open-meteo.com for layer 'weather')",
      }));
    }
    if (points.length === 0) {
      throw new LayerError('E_BAD_RESPONSE', 'Open-Meteo answered but contained no positioned results');
    }
    return assertLabeled(points);
  },

  /** Real probe: one-site forecast, honestly 'unregistered' today. */
  async check() {
    return probeSource(`${FORECAST}?latitude=52.52&longitude=13.405&current=temperature_2m`, {
      layerId: 'weather',
      maxBytes: 100_000,
    });
  },
};

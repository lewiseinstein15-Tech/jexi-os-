/**
 * JEXI OS — Phase 9 Scope I — cameras layer (public CCTV).
 *
 * Zone: intelligence/layers/**. Transport: Scope A trust pipeline ONLY.
 *
 * HONEST ABSENCE: the intended keyless source (TfL JamCams — public
 * traffic-camera metadata with coordinates, no API key) has NO
 * registration in the trust pipeline (Scope A registry has no
 * layer-serving entry for 'cameras'). The layer is fully implemented and
 * will work the moment a registration exists; until then every fetch is
 * refused by the broker with E_UNREGISTERED_HOST and surfaced as
 * E_LAYER_UNAVAILABLE. Registering the host is a ZONE-OWNER TASK — this
 * scope must not modify intelligence/trust-pipeline/**.
 */

import { fetchJson, makePoint, labelPoint, assertLabeled, probeSource, LayerError } from './_shared.js';

const SOURCE = 'Transport for London — JamCams (public traffic cameras)';
const JAMCAMS = 'https://api.tfl.gov.uk/Place/Type/JamCam';

export default {
  id: 'cameras',
  label: 'Public Cameras',
  tier: 0,
  keyless: true, // JamCams needs no API key
  source: {
    name: SOURCE,
    url: 'https://api.tfl.gov.uk/',
    license: 'TfL Open Data — Crown copyright, Open Government Licence (attribution required)',
  },

  /**
   * Public camera positions (id, name, lat/lon, still-image URL).
   * @param {{ limit?: number }} [opts]
   * @throws LayerError E_LAYER_UNAVAILABLE (cause: E_UNREGISTERED_HOST —
   *   zone-owner registration task) until the host is registered.
   */
  async fetch(opts = {}) {
    const limit = Number(opts.limit ?? 20) || 20;
    let body;
    try {
      ({ body } = await fetchJson(JAMCAMS, { maxBytes: 2_000_000 }));
    } catch (err) {
      if (err instanceof LayerError && err.cause?.code === 'E_UNREGISTERED_HOST') {
        throw new LayerError(
          'E_LAYER_UNAVAILABLE',
          `${err.message} — cameras layer is implemented but its host has no trust-pipeline registration; ` +
            `zone-owner task: register api.tfl.gov.uk (/Place/Type/JamCam) for layer 'cameras'`,
          { cause: err.cause },
        );
      }
      throw err;
    }
    if (!Array.isArray(body)) {
      throw new LayerError('E_BAD_RESPONSE', 'JamCams response is not a JSON array');
    }
    const points = [];
    for (const cam of body) {
      const lat = cam?.lat;
      const lon = cam?.lon;
      if (typeof lat !== 'number' || typeof lon !== 'number') continue;
      const imageUrl = (cam?.additionalProperties ?? []).find((p) => p?.key === 'imageUrl')?.value ?? null;
      points.push(labelPoint(makePoint({
        cameraId: cam?.id ?? null,
        name: cam?.commonName ?? null,
        imageUrl,
      }, { lat, lon }), {
        label: 'observed',
        source: SOURCE,
        method: 'brokered fetch — TfL Place/Type/JamCam camera metadata',
        notes: "registration (zone-owner task: api.tfl.gov.uk for layer 'cameras')",
      }));
      if (points.length >= limit) break;
    }
    if (points.length === 0) {
      throw new LayerError('E_BAD_RESPONSE', 'JamCams answered but contained no positioned cameras');
    }
    return assertLabeled(points);
  },

  /** Real probe: the JamCams endpoint, honestly 'unregistered' today. */
  async check() {
    return probeSource(JAMCAMS, { layerId: 'cameras', maxBytes: 200_000 });
  },
};

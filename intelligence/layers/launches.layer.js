/**
 * JEXI OS — Phase 9 Scope I — launches layer (Launch Library 2).
 *
 * Zone: intelligence/layers/**. Transport: Scope A trust pipeline ONLY
 * (registration 'launch-library-2' — ll.thespacedevs.com, keyless,
 * provenance 'observed'). No raw fetch. No simulated points.
 *
 * Build-time sandbox status: VERIFIED REACHABLE (brokered HTTP 200).
 * check() re-probes live every call.
 */

import { fetchJson, makePoint, labelPoint, assertLabeled, probeSource } from './_shared.js';

const SOURCE = 'Launch Library 2 (The Space Devs)';
const UPCOMING = 'https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=';
const CHECK_URL = 'https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=1';

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

export default {
  id: 'launches',
  label: 'Launches',
  tier: 0,
  keyless: true,
  source: {
    name: SOURCE,
    url: 'https://ll.thespacedevs.com/',
    license: 'CC BY-SA 4.0 — Launch Library 2 data (attribution required)',
  },

  /**
   * Real upcoming launches with their launch-pad coordinates.
   * Points whose pad has no published coordinates are dropped (never
   * invented); LL2 pads occasionally lack lat/lon.
   * @param {{ limit?: number }} [opts]
   * @returns {Promise<Array<{ lat, lon, launchId, name, net, status, provider, pad, location, slug, provenance }>>}
   * @throws LayerError E_LAYER_UNAVAILABLE / E_BAD_RESPONSE
   */
  async fetch(opts = {}) {
    const limit = clamp(Number(opts.limit ?? 5) || 5, 1, 10);
    const { body } = await fetchJson(`${UPCOMING}${limit}`, { maxBytes: 3_000_000 });
    if (!Array.isArray(body?.results)) {
      throw new LayerError('E_BAD_RESPONSE', 'Launch Library 2 response has no results[] array');
    }
    const points = [];
    for (const r of body.results) {
      // LL2 publishes pad coordinates as strings ("34.632") — coerce, then
      // gate: a pad with no usable position is dropped, never invented.
      const lat = typeof r?.pad?.latitude === 'number' ? r.pad.latitude : Number(r?.pad?.latitude);
      const lon = typeof r?.pad?.longitude === 'number' ? r.pad.longitude : Number(r?.pad?.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue; // no pad position → no fabricated point
      points.push(labelPoint(makePoint({
        launchId: r.id ?? null,
        name: r.name ?? null,
        net: r.net ?? null, // NET: no earlier than — official target time
        status: r?.status?.abbrev ?? null,
        provider: r?.launch_service_provider?.name ?? null,
        pad: r?.pad?.name ?? null,
        location: r?.pad?.location?.name ?? null,
        slug: r.slug ?? null,
      }, { lat, lon }), {
        label: 'observed',
        source: SOURCE,
        method: 'brokered fetch — LL2 /2.2.0/launch/upcoming/ (pad coordinates from the launch record)',
        notes: 'registration launch-library-2 (layer: launches)',
      }));
    }
    return assertLabeled(points);
  },

  /** Real probe: one-record upcoming-launch query through the trust pipeline. */
  async check() {
    return probeSource(CHECK_URL, { layerId: 'launches', maxBytes: 200_000 });
  },
};

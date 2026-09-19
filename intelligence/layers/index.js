/**
 * JEXI OS — Phase 9 Scope I — OSINT spatial layer registry.
 *
 * Zone: intelligence/layers/**. This is the single enumeration point for
 * the 13 layers. Governance cross-check: every layer's endpoints must be
 * served by a registration in
 * intelligence/trust-pipeline/registered-urls.js (Scope A) that carries
 * the SAME layer id — each layer's check() verifies this at runtime via
 * _shared.probeSource().
 *
 * Layer contract (every file):
 *   {
 *     id: string,            // stable layer id (== registry `layer` field)
 *     label: string,         // human-readable name
 *     tier: 0 | 1 | 2,       // 0 keyless, 1 needs key, 2 login
 *     keyless: boolean,      // operator-honesty field (registry mirror)
 *     source: { name, url, license },
 *     fetch(opts) -> Array<{ lat, lon, ...data, provenance }>,  // Scope G labeled
 *     check() -> Promise<{ status, message }>,                  // REAL probe
 *   }
 *
 * fetch() failures are honest: LayerError with E_LAYER_UNAVAILABLE (or a
 * more specific code) and the SPECIFIC reason. No simulated points, ever.
 */

import flights from './flights.layer.js';
import ships from './ships.layer.js';
import satellites from './satellites.layer.js';
import earthquakes from './earthquakes.layer.js';
import fires from './fires.layer.js';
import cameras from './cameras.layer.js';
import radio from './radio.layer.js';
import launches from './launches.layer.js';
import traffic from './traffic.layer.js';
import weather from './weather.layer.js';
import astronomy from './astronomy.layer.js';
import marine from './marine.layer.js';
import bikeshare from './bikeshare.layer.js';

export const LAYERS = Object.freeze([
  flights,
  ships,
  satellites,
  earthquakes,
  fires,
  cameras,
  radio,
  launches,
  traffic,
  weather,
  astronomy,
  marine,
  bikeshare,
]);

/** Registry surface per the Scope I block: metadata + live check(). */
export function listLayers() {
  return LAYERS.map((l) => ({
    id: l.id,
    label: l.label,
    tier: l.tier,
    keyless: l.keyless,
    source: l.source,
    check: l.check,
  }));
}

/** Layer lookup by id (null when unknown). */
export function getLayer(id) {
  return LAYERS.find((l) => l.id === id) || null;
}

export default LAYERS;

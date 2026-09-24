/**
 * JEXI OS — Phase 9 Scope A — Registered URL registry (single source of truth).
 *
 * Every external URL the trust-pipeline broker is allowed to contact must be
 * declared here. Registration is host + path-prefix scoped, https-only.
 *
 * This registry is the seed for the Phase 9 OSINT spatial layers (Scope I):
 * each entry carries the layer id it serves so governance can cross-check
 * "every layer's endpoint is registered" later.
 *
 * Provenance defaults follow the Phase 9 Scope G vocabulary:
 *   'observed'      — real measurement from the source
 *   'estimated'     — interpolated / inferred
 *   'simulated'     — mock / demonstration
 *   'reconstructed' — best-effort from partial data
 *
 * keyless: whether the endpoint is usable without any API key (operator
 * honesty field — mirrors the GEV keyless-tier audit).
 */

export const REGISTRY_VERSION = 1;

/**
 * Entry shape:
 * {
 *   id: string,                 // stable registration id
 *   host: string,               // exact hostname (no wildcards, no ports)
 *   pathPrefixes: string[],     // allowed path prefixes ('/' = whole host)
 *   layer: string|null,         // Phase 9 layer id this registration serves
 *   provider: string,           // human-readable provider name
 *   keyless: boolean,           // true = no API key needed
 *   provenance: string,         // default provenance label for its data
 *   note: string
 * }
 */
export const REGISTERED_URLS = [
  // ── flights (OpenSky + adsb.lol) ─────────────────────────────────────────
  {
    id: 'opensky-states',
    host: 'opensky-network.org',
    pathPrefixes: ['/api/states', '/api/auth'],
    layer: 'flights',
    provider: 'OpenSky Network',
    keyless: true,
    provenance: 'observed',
    note: 'Anonymous tier exists; OAuth optional for higher polling budget',
  },
  {
    id: 'adsb-lol',
    host: 'api.adsb.lol',
    pathPrefixes: ['/v2/'],
    layer: 'flights',
    provider: 'adsb.lol',
    keyless: true,
    provenance: 'observed',
    note: 'Keyless ADS-B aggregator (community receivers)',
  },

  // ── satellites (CelesTrak) ───────────────────────────────────────────────
  {
    id: 'celestrak-gp',
    host: 'celestrak.org',
    pathPrefixes: ['/NORAD/elements/gp.php'],
    layer: 'satellites',
    provider: 'CelesTrak',
    keyless: true,
    provenance: 'observed',
    note: 'TLE/GP element sets',
  },

  // ── earthquakes (USGS) ───────────────────────────────────────────────────
  {
    id: 'usgs-summary',
    host: 'earthquake.usgs.gov',
    pathPrefixes: ['/earthquakes/feed/', '/fdsnws/'],
    layer: 'earthquakes',
    provider: 'USGS',
    keyless: true,
    provenance: 'observed',
    note: 'Public geojson + fdsn event feeds',
  },

  // ── fires (NASA FIRMS) ───────────────────────────────────────────────────
  {
    id: 'nasa-firms',
    host: 'firms.modaps.eosdis.nasa.gov',
    pathPrefixes: ['/api/area/csv/', '/data/active_fire/'],
    layer: 'fires',
    provider: 'NASA FIRMS',
    keyless: false,
    provenance: 'observed',
    note: 'MAP_KEY required for the area API; static archive is keyless',
  },

  // ── radio (Radio Browser) ────────────────────────────────────────────────
  {
    id: 'radio-browser-servers',
    host: 'all.api.radio-browser.info',
    pathPrefixes: ['/json/servers'],
    layer: 'radio',
    provider: 'Radio Browser',
    keyless: true,
    provenance: 'observed',
    note: 'Directory of mirror servers (strict path — GEV doctrine)',
  },
  {
    id: 'radio-browser-de1',
    host: 'de1.api.radio-browser.info',
    pathPrefixes: ['/json/stations', '/json/url'],
    layer: 'radio',
    provider: 'Radio Browser',
    keyless: true,
    provenance: 'observed',
    note: 'Mirror; station search + click tracking',
  },
  {
    id: 'radio-browser-de2',
    host: 'de2.api.radio-browser.info',
    pathPrefixes: ['/json/stations', '/json/url'],
    layer: 'radio',
    provider: 'Radio Browser',
    keyless: true,
    provenance: 'observed',
    note: 'Mirror; station search + click tracking',
  },

  // ── bikeshare / micromobility (GBFS) ─────────────────────────────────────
  {
    id: 'gbfs-systems',
    host: 'gbfs.github.io',
    pathPrefixes: ['/gbfs/'],
    layer: 'bikeshare',
    provider: 'GBFS (NABSA)',
    keyless: true,
    provenance: 'observed',
    note: 'Systems index; individual feeds registered per operator host',
  },

  // ── launches (Launch Library 2) ──────────────────────────────────────────
  {
    id: 'launch-library-2',
    host: 'll.thespacedevs.com',
    pathPrefixes: ['/2.2.0/', '/2.3.0/'],
    layer: 'launches',
    provider: 'Launch Library 2 (The Space Devs)',
    keyless: true,
    provenance: 'observed',
    note: 'Upcoming/previous launches; optional token raises the allowance',
  },

  // ── traffic / places (OSM Overpass + TomTom) ─────────────────────────────
  {
    id: 'overpass-api',
    host: 'overpass-api.de',
    pathPrefixes: ['/api/interpreter', '/api/status'],
    layer: 'traffic',
    provider: 'OpenStreetMap Overpass API',
    keyless: true,
    provenance: 'observed',
    note: 'OSM road/network queries',
  },
  {
    id: 'tomtom-traffic',
    host: 'api.tomtom.com',
    pathPrefixes: ['/traffic/', '/routing/', '/search/'],
    layer: 'traffic',
    provider: 'TomTom',
    keyless: false,
    provenance: 'observed',
    note: 'Keyed live flow speeds + routing',
  },

  // ── map tiles (Google; keyed) ────────────────────────────────────────────
  {
    id: 'google-map-tiles',
    host: 'tile.googleapis.com',
    pathPrefixes: ['/v1/'],
    layer: 'map-stack',
    provider: 'Google Map Tiles',
    keyless: false,
    provenance: 'observed',
    note: 'Photorealistic 3D tiles / session tokens (metered key)',
  },

  // ── marine (AIS) ─────────────────────────────────────────────────────────
  // NOTE: AISStream is a WSS stream (wss://stream.aisstream.io) with an API
  // key — it is NOT an https fetch and is deliberately NOT registered here.
  // The ships layer (Scope I) brokers it separately; the HTTP broker would
  // refuse it, and that refusal is correct.
];

/** Look up a registration by id. */
export function getRegistration(id) {
  return REGISTERED_URLS.find((r) => r.id === id) || null;
}

/** Registrations serving a given layer id (Scope I governance aid). */
export function registrationsForLayer(layerId) {
  return REGISTERED_URLS.filter((r) => r.layer === layerId);
}

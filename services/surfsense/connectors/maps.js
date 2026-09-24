/**
 * JEXI OS — Phase 19 Scope A — maps connector.
 *
 * SurfSense research note: place/POI retrieval runs through a maps platform
 * REST API (Google Maps Platform) with an API key. Credentials are
 * unavailable in this sandbox -> live: false, and fetch() throws
 * E_LIVE_UNAVAILABLE (truthful; no fake live responses).
 */
import { createConnector, liveUnavailableFetch } from './_connector.js';

export default createConnector({
  name: 'maps',
  capabilities: { live: false, auth: 'token' },
  fetch: liveUnavailableFetch('maps', 'token', ['GOOGLE_MAPS_API_KEY']),
});

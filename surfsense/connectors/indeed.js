/**
 * JEXI OS — Phase 19 Scope A — indeed connector.
 *
 * SurfSense research note: job-board retrieval (Indeed) runs through the
 * Indeed job search API family using a publisher/employer API key.
 * Credentials are unavailable in this sandbox -> live: false, and fetch()
 * throws E_LIVE_UNAVAILABLE (truthful; no fake live responses).
 */
import { createConnector, liveUnavailableFetch } from './_connector.js';

export default createConnector({
  name: 'indeed',
  capabilities: { live: false, auth: 'token' },
  fetch: liveUnavailableFetch('indeed', 'token', ['INDEED_API_KEY']),
});

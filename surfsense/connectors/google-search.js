/**
 * JEXI OS — Phase 19 Scope A — google-search connector.
 *
 * SurfSense research note: general web search runs through a search-engine
 * REST API (Google Custom Search JSON API / Serper-style key). Credentials
 * are unavailable in this sandbox -> live: false, and fetch() throws
 * E_LIVE_UNAVAILABLE (truthful; no fake live responses). The sandbox-verifiable
 * member of the "search engines" category is local-search (real local index).
 */
import { createConnector, liveUnavailableFetch } from './_connector.js';

export default createConnector({
  name: 'google-search',
  capabilities: { live: false, auth: 'token' },
  fetch: liveUnavailableFetch('google-search', 'token', ['GOOGLE_SEARCH_API_KEY']),
});

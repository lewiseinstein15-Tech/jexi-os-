/**
 * JEXI OS — Phase 19 Scope A — tiktok connector.
 *
 * SurfSense research note: TikTok content is retrievable through the TikTok
 * API family (Display API / Research API) using an access token. Credentials
 * are unavailable in this sandbox -> live: false, and fetch() throws
 * E_LIVE_UNAVAILABLE (truthful; no fake live responses).
 */
import { createConnector, liveUnavailableFetch } from './_connector.js';

export default createConnector({
  name: 'tiktok',
  capabilities: { live: false, auth: 'token' },
  fetch: liveUnavailableFetch('tiktok', 'token', ['TIKTOK_ACCESS_TOKEN']),
});

/**
 * JEXI OS — Phase 19 Scope A — instagram connector.
 *
 * SurfSense research note: Instagram content is exposed through the Instagram
 * Graph API with a business/user access token. Credentials are unavailable in
 * this sandbox -> live: false, and fetch() throws E_LIVE_UNAVAILABLE
 * (truthful; no fake live responses).
 */
import { createConnector, liveUnavailableFetch } from './_connector.js';

export default createConnector({
  name: 'instagram',
  capabilities: { live: false, auth: 'token' },
  fetch: liveUnavailableFetch('instagram', 'token', ['INSTAGRAM_ACCESS_TOKEN']),
});

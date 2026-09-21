/**
 * JEXI OS — Phase 19 Scope A — reddit connector.
 *
 * SurfSense research note: Reddit exposes its search/trending content through
 * the Reddit API, which requires OAuth2 (client id + secret -> access token).
 * Credentials are unavailable in this sandbox -> live: false, and fetch()
 * throws E_LIVE_UNAVAILABLE (truthful; no fake live responses).
 */
import { createConnector, liveUnavailableFetch } from './_connector.js';

export default createConnector({
  name: 'reddit',
  capabilities: { live: false, auth: 'oauth' },
  fetch: liveUnavailableFetch('reddit', 'oauth', ['REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET']),
});

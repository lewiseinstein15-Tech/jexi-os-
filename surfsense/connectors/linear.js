/**
 * JEXI OS — Phase 19 Scope A — linear connector.
 *
 * SurfSense research note: SurfSense ships linear_connector.py — Linear
 * GraphQL API access with OAuth access/refresh token handling and token
 * decryption. Credentials are unavailable in this sandbox -> live: false,
 * and fetch() throws E_LIVE_UNAVAILABLE (truthful; no fake live responses).
 */
import { createConnector, liveUnavailableFetch } from './_connector.js';

export default createConnector({
  name: 'linear',
  capabilities: { live: false, auth: 'oauth' },
  fetch: liveUnavailableFetch('linear', 'oauth', ['LINEAR_ACCESS_TOKEN']),
});

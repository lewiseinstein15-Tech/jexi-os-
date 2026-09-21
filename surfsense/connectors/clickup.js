/**
 * JEXI OS — Phase 19 Scope A — clickup connector.
 *
 * SurfSense research note: SurfSense ships clickup_connector.py + clickup_
 * history.py — ClickUp REST API v2 access with a personal access token.
 * Credentials are unavailable in this sandbox -> live: false, and fetch()
 * throws E_LIVE_UNAVAILABLE (truthful; no fake live responses).
 */
import { createConnector, liveUnavailableFetch } from './_connector.js';

export default createConnector({
  name: 'clickup',
  capabilities: { live: false, auth: 'token' },
  fetch: liveUnavailableFetch('clickup', 'token', ['CLICKUP_TOKEN']),
});

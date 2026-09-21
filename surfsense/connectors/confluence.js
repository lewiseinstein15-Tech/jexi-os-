/**
 * JEXI OS — Phase 19 Scope A — confluence connector. (Extra #1 chosen from
 * SurfSense's own connector set: surfsense_backend/app/connectors/
 * confluence_connector.py + confluence_history.py.)
 *
 * SurfSense research note: Confluence page retrieval runs through the
 * Atlassian Confluence REST API with site, account email and API token basic
 * auth. Credentials are unavailable in this sandbox -> live: false, and
 * fetch() throws E_LIVE_UNAVAILABLE (truthful; no fake live responses).
 */
import { createConnector, liveUnavailableFetch } from './_connector.js';

export default createConnector({
  name: 'confluence',
  capabilities: { live: false, auth: 'token' },
  fetch: liveUnavailableFetch('confluence', 'token', [
    'CONFLUENCE_SITE',
    'CONFLUENCE_EMAIL',
    'CONFLUENCE_API_TOKEN',
  ]),
});

/**
 * JEXI OS — Phase 19 Scope A — jira connector.
 *
 * SurfSense research note: issue retrieval runs through the Atlassian Jira
 * REST API v3 with site, account email and API token basic auth. Credentials
 * are unavailable in this sandbox -> live: false, and fetch() throws
 * E_LIVE_UNAVAILABLE (truthful; no fake live responses).
 */
import { createConnector, liveUnavailableFetch } from './_connector.js';

export default createConnector({
  name: 'jira',
  capabilities: { live: false, auth: 'token' },
  fetch: liveUnavailableFetch('jira', 'token', [
    'JIRA_SITE',
    'JIRA_EMAIL',
    'JIRA_API_TOKEN',
  ]),
});

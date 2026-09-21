/**
 * JEXI OS — Phase 19 Scope A — github connector.
 *
 * SurfSense research note: SurfSense ships github_connector.py — repository
 * ingestion via the gitingest CLI, optionally authenticated with a GitHub
 * personal access token for private repositories. Credentials are
 * unavailable in this sandbox -> live: false, and fetch() throws
 * E_LIVE_UNAVAILABLE (truthful; no fake live responses).
 */
import { createConnector, liveUnavailableFetch } from './_connector.js';

export default createConnector({
  name: 'github',
  capabilities: { live: false, auth: 'token' },
  fetch: liveUnavailableFetch('github', 'token', ['GITHUB_TOKEN']),
});

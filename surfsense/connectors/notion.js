/**
 * JEXI OS — Phase 19 Scope A — notion connector.
 *
 * SurfSense research note: SurfSense ships notion_history.py — Notion API
 * access with an OAuth integration token (search + database query
 * endpoints). Credentials are unavailable in this sandbox -> live: false,
 * and fetch() throws E_LIVE_UNAVAILABLE (truthful; no fake live responses).
 */
import { createConnector, liveUnavailableFetch } from './_connector.js';

export default createConnector({
  name: 'notion',
  capabilities: { live: false, auth: 'oauth' },
  fetch: liveUnavailableFetch('notion', 'oauth', ['NOTION_ACCESS_TOKEN']),
});

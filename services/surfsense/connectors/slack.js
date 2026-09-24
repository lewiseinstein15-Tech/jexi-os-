/**
 * JEXI OS — Phase 19 Scope A — slack connector.
 *
 * SurfSense research note: SurfSense ships slack_history.py — channel history
 * retrieval through the Slack Web API with an OAuth bot token
 * (conversations.history / conversations.list). Credentials are unavailable
 * in this sandbox -> live: false, and fetch() throws E_LIVE_UNAVAILABLE
 * (truthful; no fake live responses).
 */
import { createConnector, liveUnavailableFetch } from './_connector.js';

export default createConnector({
  name: 'slack',
  capabilities: { live: false, auth: 'oauth' },
  fetch: liveUnavailableFetch('slack', 'oauth', ['SLACK_BOT_TOKEN']),
});

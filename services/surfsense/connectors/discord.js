/**
 * JEXI OS — Phase 19 Scope A — discord connector.
 *
 * SurfSense research note: SurfSense ships discord_connector.py — guild and
 * channel retrieval through the Discord REST API with a bot token.
 * Credentials are unavailable in this sandbox -> live: false, and fetch()
 * throws E_LIVE_UNAVAILABLE (truthful; no fake live responses).
 */
import { createConnector, liveUnavailableFetch } from './_connector.js';

export default createConnector({
  name: 'discord',
  capabilities: { live: false, auth: 'token' },
  fetch: liveUnavailableFetch('discord', 'token', ['DISCORD_BOT_TOKEN']),
});

/**
 * JEXI OS — Phase 19 Scope A — youtube connector.
 *
 * SurfSense research note: YouTube content is retrievable through the YouTube
 * Data API v3 using an API key (transcript ingestion additionally needs
 * timedtext access). Credentials are unavailable in this sandbox -> live:
 * false, and fetch() throws E_LIVE_UNAVAILABLE (truthful; no fake live
 * responses).
 */
import { createConnector, liveUnavailableFetch } from './_connector.js';

export default createConnector({
  name: 'youtube',
  capabilities: { live: false, auth: 'token' },
  fetch: liveUnavailableFetch('youtube', 'token', ['YOUTUBE_API_KEY']),
});

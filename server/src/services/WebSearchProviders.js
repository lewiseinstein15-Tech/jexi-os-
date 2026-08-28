/**
 * B164 — WEB SEARCH PROVIDERS status surface (dsh web seam, live health).
 * The old static list is gone: this now reports the REAL registry from
 * WebSearch.js — configured keys, cooldowns, keyless engines.
 */

import { webSearchHealth } from './WebSearch.js';

export function webSearchProviderStatus() {
  const providers = webSearchHealth();
  return {
    ok: true,
    search: providers,
    fetch: [{ id: 'http', name: 'HTTP Fetch', configured: true }],
    resolvedSearch: providers.find((p) => p.configured && !p.cooling)?.id || 'ddg-html',
    resolvedFetch: 'http',
  };
}

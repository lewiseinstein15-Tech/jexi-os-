/**
 * B144 — WEB SEARCH PROVIDERS (DeepSeek Harness `packages/web/web-search-deepseek`
 * + `web-search-exa` + `web-search-perplexity` + `web-fetch-http` mirror,
 * JEXI-branded).
 *
 * The provider registry for web search/fetch, mirroring dsh WebRuntime:
 * each provider declares its id, env key, and whether it is configured on
 * this deployment. JEXI's SearchEngine aggregates free engines (SearXNG,
 * DDG, Bing, Mojeek, Wikipedia, arXiv) and these are the optional
 * keyed providers the deployment can enable.
 */

export const WEB_SEARCH_PROVIDERS = [
  { id: 'searx', name: 'SearXNG', env: 'SEARXNG_URL', free: true, configured: () => true },
  { id: 'duckduckgo', name: 'DuckDuckGo', env: null, free: true, configured: () => true },
  { id: 'bing', name: 'Bing', env: null, free: true, configured: () => true },
  { id: 'mojeek', name: 'Mojeek', env: null, free: true, configured: () => true },
  { id: 'wikipedia', name: 'Wikipedia', env: null, free: true, configured: () => true },
  { id: 'arxiv', name: 'arXiv', env: null, free: true, configured: () => true },
  { id: 'deepseek', name: 'DeepSeek Search', env: 'DEEPSEEK_SEARCH_KEY', free: false, configured: () => !!process.env.DEEPSEEK_SEARCH_KEY },
  { id: 'exa', name: 'Exa', env: 'EXA_API_KEY', free: false, configured: () => !!process.env.EXA_API_KEY },
  { id: 'perplexity', name: 'Perplexity', env: 'PERPLEXITY_API_KEY', free: false, configured: () => !!process.env.PERPLEXITY_API_KEY },
];

export const WEB_FETCH_PROVIDERS = [
  { id: 'http', name: 'HTTP Fetch', env: null, free: true, configured: () => true },
];

export function webSearchProviderStatus() {
  return {
    ok: true,
    search: WEB_SEARCH_PROVIDERS.map((p) => ({ id: p.id, name: p.name, free: p.free, env: p.env, configured: p.configured() })),
    fetch: WEB_FETCH_PROVIDERS.map((p) => ({ id: p.id, name: p.name, configured: p.configured() })),
    resolvedSearch: (process.env.JEXI_WEB_SEARCH_PROVIDER || 'searx'),
    resolvedFetch: (process.env.JEXI_WEB_FETCH_PROVIDER || 'http'),
  };
}

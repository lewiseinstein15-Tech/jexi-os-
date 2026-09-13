/**
 * JEXI OS — Search provider: DeepSeek web search.
 *
 * Provider-layer descriptor for the DeepSeek Search (Anthropic-compatible
 * messages endpoint with the native `web_search_20250305` server tool).
 * Lives in providers/search/ so no provider name, URL, or wire-format
 * header (e.g. `anthropic-version`) leaks into business logic.
 *
 * WebSearch.js imports this descriptor and injects its seam deps
 * ({ keyFor, httpCall, WebError }) so the provider stays self-contained
 * and never imports a services/ module.
 */

/**
 * dsh web-search-deepseek: POST {base}/messages (Anthropic-compatible) with
 * the native web_search_20250305 server tool. STRICT: no
 * web_search_tool_result block => WEB_PROVIDER_ERROR (never prose-scrape).
 * Citations (cited_text) are joined to sources by URL.
 */
export function createDeepseekSearchProvider(deps) {
  const keyFor = deps.keyFor;
  const httpCall = deps.httpCall;
  const WebError = deps.WebError;

  return {
    id: 'deepseek-official', name: 'DeepSeek Search', keyless: false,
    envKey: 'DEEPSEEK_API_KEY',
    baseURL: () => process.env.DEEPSEEK_SEARCH_BASE_URL || 'https://api.deepseek.com/anthropic/v1',
    model: () => process.env.DEEPSEEK_SEARCH_MODEL || 'deepseek-v4-flash',
    configured() { return !!keyFor(this.envKey); },
    async search(req, signal) {
      const apiKey = keyFor(this.envKey);
      if (!apiKey) throw new WebError(deps.CREDENTIAL_MISSING || 'WEB_PROVIDER_CREDENTIAL_MISSING', 'DEEPSEEK_API_KEY not set');
      const res = await httpCall(`${this.baseURL()}/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': process.env.DEEPSEEK_SEARCH_API_VERSION || '2023-06-01',
          'Content-Type': 'application/json',
        },
        signal,
        body: JSON.stringify({
          model: this.model(),
          max_tokens: 4096,
          messages: [{ role: 'user', content: [{ type: 'text', text: req.query }] }],
          tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
        }),
      }).catch((e) => { throw new WebError(deps.PROVIDER_ERROR || 'WEB_PROVIDER_ERROR', `deepseek search: ${e.message}`); });
      if (!res.ok) throw new WebError(deps.PROVIDER_ERROR || 'WEB_PROVIDER_ERROR', `deepseek search HTTP ${res.status}`);
      const data = await res.json().catch(() => { throw new WebError(deps.PROVIDER_ERROR || 'WEB_PROVIDER_ERROR', 'deepseek search: bad json'); });
      // Two-pass mapping (dsh): pass 1 collects result items AND citation
      // excerpts (blocks may arrive in any order); pass 2 joins them by URL.
      const byUrl = new Map();
      const citations = new Map(); // url -> cited_text
      for (const block of data.content || []) {
        if (block.type === 'web_search_tool_result') {
          for (const item of block.content || []) {
            if (item.url && !byUrl.has(item.url)) {
              byUrl.set(item.url, { url: item.url, title: item.title || undefined, ...(item.page_age ? { publishedAt: item.page_age } : {}) });
            }
            if (item.cited_text) citations.set(item.url, item.cited_text.replace(/\s+/g, ' ').trim().slice(0, 300));
          }
        } else if (block.type === 'text') {
          for (const c of block.citations || []) {
            if (c.url && !citations.has(c.url)) citations.set(c.url, String(c.cited_text || '').replace(/\s+/g, ' ').trim().slice(0, 300));
          }
        }
      }
      if (!byUrl.size) throw new WebError(deps.PROVIDER_ERROR || 'WEB_PROVIDER_ERROR', 'deepseek search: no web_search_tool_result block (strict mode)');
      for (const [url, src] of byUrl) {
        const excerpt = citations.get(url);
        if (excerpt && !src.snippet) src.snippet = excerpt;
      }
      let sources = [...byUrl.values()].slice(0, (req.maxResults || 10));
      if (deps.isGarbageUrl) sources = sources.filter((s) => !deps.isGarbageUrl(s.url));
      return { content: undefined, truncated: (byUrl.size || 0) > (req.maxResults || 10), sources };
    },
  };
}
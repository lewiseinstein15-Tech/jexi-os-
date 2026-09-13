/**
 * JEXI OS — Search providers registry (keyed DSH trio).
 *
 * Owns the construction of the KEYED search providers so business logic
 * (WebSearch.js) never imports a named provider factory. Callers ask for
 * "all keyed search providers" or for "the provider for env key X" through
 * providers/index.js — the provider name stays in this layer.
 *
 * The seam deps ({ keyFor, httpCall, WebError, isGarbageUrl,
 * PROVIDER_ERROR, CREDENTIAL_MISSING }) are injected by the caller so this
 * layer stays self-contained and never imports a services/ module.
 */

import { createDeepseekSearchProvider } from './deepseek-search.js';

/** Build the three keyed search providers (deepseek / exa / perplexity). */
export function createKeyedSearchProviders(deps = {}) {
  const {
    keyFor = () => '', httpCall, WebError, isGarbageUrl = () => false,
    PROVIDER_ERROR = 'WEB_PROVIDER_ERROR', CREDENTIAL_MISSING = 'WEB_PROVIDER_CREDENTIAL_MISSING',
  } = deps;

  const deepseek = createDeepseekSearchProvider({
    keyFor, httpCall, WebError, isGarbageUrl,
    PROVIDER_ERROR, CREDENTIAL_MISSING,
  });

  const exa = {
    id: 'exa', name: 'Exa', keyless: false,
    envKey: 'EXA_API_KEY',
    baseURL: () => process.env.EXA_BASE_URL || 'https://api.exa.ai',
    configured() { return !!keyFor(this.envKey); },
    async search(req, signal) {
      const apiKey = keyFor(this.envKey);
      if (!apiKey) throw new WebError(CREDENTIAL_MISSING, 'EXA_API_KEY not set');
      const res = await httpCall(`${this.baseURL()}/search`, {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({ query: req.query, numResults: req.maxResults ?? 8, type: 'auto' }),
      }).catch((e) => { throw new WebError(PROVIDER_ERROR, `exa: ${e.message}`); });
      if (!res.ok) throw new WebError(PROVIDER_ERROR, `exa HTTP ${res.status}`);
      const data = await res.json().catch(() => { throw new WebError(PROVIDER_ERROR, 'exa: bad json'); });
      const sources = (data.results || []).map((r) => ({ url: r.url, title: r.title || undefined, snippet: r.text ? String(r.text).slice(0, 300) : undefined, ...(r.publishedDate ? { publishedAt: r.publishedDate } : {}) }));
      if (!sources.length) throw new WebError(PROVIDER_ERROR, 'exa empty');
      return { sources: sources.filter((s) => !isGarbageUrl(s.url)) };
    },
  };

  const perplexity = {
    id: 'perplexity', name: 'Perplexity', keyless: false,
    envKey: 'PERPLEXITY_API_KEY',
    baseURL: () => process.env.PERPLEXITY_BASE_URL || 'https://api.perplexity.ai',
    model: () => process.env.PERPLEXITY_MODEL || 'sonar',
    configured() { return !!keyFor(this.envKey); },
    async search(req, signal) {
      const apiKey = keyFor(this.envKey);
      if (!apiKey) throw new WebError(CREDENTIAL_MISSING, 'PERPLEXITY_API_KEY not set');
      const res = await httpCall(`${this.baseURL()}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({ model: this.model(), messages: [{ role: 'user', content: req.query }] }),
      }).catch((e) => { throw new WebError(PROVIDER_ERROR, `perplexity: ${e.message}`); });
      if (!res.ok) throw new WebError(PROVIDER_ERROR, `perplexity HTTP ${res.status}`);
      const data = await res.json().catch(() => { throw new WebError(PROVIDER_ERROR, 'perplexity: bad json'); });
      const content = data?.choices?.[0]?.message?.content || undefined;
      const raw = data?.search_results?.map((r) => ({ url: r.url, title: r.title || undefined }))
        ?? (data?.citations || []).map((u) => ({ url: u }));
      const sources = (raw || []).filter((s) => s.url && !isGarbageUrl(s.url));
      if (!sources.length && !content) throw new WebError(PROVIDER_ERROR, 'perplexity empty');
      return { ...(content ? { content } : {}), sources };
    },
  };

  return [deepseek, exa, perplexity];
}

/** Look up a keyed search provider by its config env key (e.g. 'EXA_API_KEY'). */
export function searchProviderByEnvKey(envKey, deps) {
  return (createKeyedSearchProviders(deps) || []).find((p) => p.envKey === envKey) ?? null;
}
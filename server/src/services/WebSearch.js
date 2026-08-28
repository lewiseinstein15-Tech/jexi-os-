/**
 * B164 — WEB SEARCH SEAM (DeepSeek Harness `packages/web/web` — `ctx.web` —
 * faithful port). THE search pipeline: every search in JEXI goes through
 * this seam now.
 *
 * DSH shape (from packages/web/web/src/types.ts + the three providers):
 *   WebSearchProvider  — { id, name, configured(), search(req, signal) }
 *   WebSearchRequest   — { query, maxResults? }
 *   WebSearchResult    — { content?, sources[], truncated }
 *   WebSearchSource    — { url, title?, snippet?, publishedAt? }
 *   WebError           — coded failures; STRICT mode: structured results
 *                        only, never prose-scraping (deepseek provider).
 *   The seam dedupes by URL and truncates to maxResults (truncated flag).
 *
 * Providers (DSH trio mirrored exactly + keyless whole-web engines):
 *   KEYED   deepseek-official  — POST {base}/messages with the native
 *                                web_search_20250305 server tool, joins
 *                                citation excerpts by URL (dsh
 *                                web-search-deepseek). STRICT.
 *   KEYED   exa                — POST {base}/search, numResults (dsh
 *                                web-search-exa).
 *   KEYED   perplexity         — POST {base}/chat/completions, model sonar,
 *                                citations → sources + generated content
 *                                (dsh web-search-perplexity).
 *   KEYLESS ddg-html / ddg-lite / mojeek / bing / searxng / wikipedia /
 *           arxiv — the whole internet without any API key.
 *
 * Health: a provider that fails (or returns nothing) 3× in a row enters a
 * 10-minute cooldown and the seam slides down the order — the same
 * ProviderRouter idea JEXI uses for LLMs. Credentials resolve PER CALL
 * (CredentialStore → env), so a key added in Settings reaches the next
 * search without a restart (dsh: "the seam never flickers").
 */

import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import { resolveCredential } from './CredentialStore.js';

/* ══════════════════ WebError (dsh web WebError mirror) ══════════════════ */

export class WebError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'WebError';
    this.code = code;
  }
}
export const WEB_ERRORS = {
  PROVIDER_ERROR: 'WEB_PROVIDER_ERROR',
  CREDENTIAL_MISSING: 'WEB_PROVIDER_CREDENTIAL_MISSING',
  ABORTED: 'WEB_ABORTED',
};

/* ══════════════════ quality filters (kept from JEXI — they work) ═════════ */

const BAD_DOMAINS = ['pinterest.com', 'facebook.com', 'instagram.com', 'tiktok.com', 'quora.com', 'adf.ly', 'bit.ly'];
const BAD_SNIPPET_MARKERS = ['sign up to continue', 'subscribe to continue', 'enable javascript', 'are you a robot'];

function isGarbageUrl(url) {
  try {
    const host = new URL(url).hostname;
    if (BAD_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`))) return true;
    if (url.includes('ad_domain=')) return true;
    if (host === 'duckduckgo.com' || host === 'mojeek.com' || host.endsWith('.bing.com') || host === 'bing.com') return true;
    if (url.includes('bing.com/ck/')) return true; // bing redirect wrappers — never a real destination
    return false;
  } catch { return true; }
}
function isGarbageText(title, snippet) {
  const blob = `${title} ${snippet || ''}`.toLowerCase();
  return !String(title || '').trim() || blob.length < 8 || BAD_SNIPPET_MARKERS.some((m) => blob.includes(m));
}

/** Canonical URL for dedup (strips tracking params + trailing slash). */
export function canonicalUrl(url) {
  try {
    const u = new URL(String(url));
    for (const p of [...u.searchParams.keys()]) if (/^(utm_|ref|ref_src|gclid|fbclid|si$)/i.test(p)) u.searchParams.delete(p);
    u.hash = '';
    let s = u.toString();
    if (s.endsWith('/')) s = s.slice(0, -1);
    return s;
  } catch { return String(url || ''); }
}

/* ══════════════════ fetch helper (direct → proxy fallback) ═══════════════ */

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/** Test seam: when set, the DSH keyed providers use this instead of fetch. */
export const __testFetch = { fn: null };
const httpCall = (url, opts) => (__testFetch.fn ? __testFetch.fn(url, opts) : fetch(url, opts));

/** Direct first; if blocked, race 3 independent proxy lanes and take the
 *  first good answer — datacenter IPs get HTML engines blocked constantly,
 *  and a single proxy is a single point of failure (the old Wikipedia-flood
 *  bug: engines blocked → wikipedia dominated every search). */
async function fetchWithFallback(url, headers, timeoutMs) {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    if (res.ok) return res;
  } catch { /* fall through to the proxy race */ }
  const proxied = encodeURIComponent(url);
  const lanes = [
    `https://api.allorigins.win/raw?url=${proxied}`,
    `https://api.codetabs.com/v1/proxy?quest=${proxied}`,
    `https://corsproxy.io/?${proxied}`,
  ];
  const attempts = lanes.map(async (lane) => {
    const res = await fetch(lane, { headers: { 'User-Agent': BROWSER_UA }, signal: AbortSignal.timeout(timeoutMs + 6000) });
    if (!res.ok) throw new Error(`lane ${res.status}`);
    const text = await res.text();
    if (!text || text.length < 200) throw new Error('lane empty');
    return text;
  });
  try {
    const text = await Promise.any(attempts);
    return { ok: true, text: async () => text, json: async () => JSON.parse(text) };
  } catch { /* every lane failed */ }
  return null;
}

/* ══════════════════ credential resolution (per call) ═════════════════════ */

/** env name → every stored alias that may hold it (dsh: credentials are
 *  resolved per call, so a key saved in Settings reaches the NEXT search). */
const KEY_ALIASES = {
  DEEPSEEK_API_KEY: ['deepseek_api_key', 'deepseekkey', 'deepseek'],
  EXA_API_KEY: ['exa_api_key', 'exakey', 'exa'],
  PERPLEXITY_API_KEY: ['perplexity_api_key', 'perplexitykey', 'perplexity'],
};

function keyFor(envName) {
  const names = [envName.toLowerCase(), ...(KEY_ALIASES[envName] || [])];
  for (const n of names) {
    try { const v = resolveCredential(n); if (v) return v; } catch { /* store absent */ }
  }
  return process.env[envName] || '';
}

/* ══════════════════ KEYLESS PROVIDERS (the whole internet, no key) ═══════ */

function ddgParse(html, selector) {
  const $ = cheerio.load(html);
  const out = [];
  const rows = selector === 'lite' ? $('a.result-link') : $('.result');
  rows.slice(0, 8).each((_, el) => {
    const a = selector === 'lite' ? $(el) : $(el).find('.result__a');
    const title = a.text().trim();
    let link = a.attr('href') || '';
    const uddg = link.match(/uddg=([^&]+)/);
    if (uddg) link = decodeURIComponent(uddg[1]);
    const snippet = selector === 'lite'
      ? $(el).closest('tr').next('tr').find('.result-snippet').text().trim()
      : $(el).find('.result__snippet').text().trim();
    if (title && link && /^https?:/.test(link)) out.push({ url: link, title, snippet: snippet.slice(0, 300) });
  });
  return out;
}

export const ddgHtmlProvider = {
  id: 'ddg-html', name: 'DuckDuckGo', keyless: true,
  configured: () => true,
  async search(req) {
    const res = await fetchWithFallback(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(req.query)}`,
      { 'User-Agent': BROWSER_UA }, 8000,
    );
    if (!res) throw new WebError(WEB_ERRORS.PROVIDER_ERROR, 'ddg-html blocked');
    const sources = ddgParse(await res.text(), 'html').filter((s) => !isGarbageUrl(s.url) && !isGarbageText(s.title, s.snippet));
    if (!sources.length) throw new WebError(WEB_ERRORS.PROVIDER_ERROR, 'ddg-html empty');
    return { sources };
  },
};

export const ddgLiteProvider = {
  id: 'ddg-lite', name: 'DuckDuckGo Lite', keyless: true,
  configured: () => true,
  async search(req) {
    const res = await fetchWithFallback(
      `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(req.query)}`,
      { 'User-Agent': BROWSER_UA }, 8000,
    );
    if (!res) throw new WebError(WEB_ERRORS.PROVIDER_ERROR, 'ddg-lite blocked');
    const sources = ddgParse(await res.text(), 'lite').filter((s) => !isGarbageUrl(s.url) && !isGarbageText(s.title, s.snippet));
    if (!sources.length) throw new WebError(WEB_ERRORS.PROVIDER_ERROR, 'ddg-lite empty');
    return { sources };
  },
};

export const mojeekProvider = {
  id: 'mojeek', name: 'Mojeek', keyless: true,
  configured: () => true,
  async search(req) {
    const res = await fetchWithFallback(
      `https://www.mojeek.com/search?q=${encodeURIComponent(req.query)}`,
      { 'User-Agent': BROWSER_UA }, 8000,
    );
    if (!res) throw new WebError(WEB_ERRORS.PROVIDER_ERROR, 'mojeek blocked');
    const $ = cheerio.load(await res.text());
    const sources = [];
    $('ul.results-standard li').slice(0, 8).each((_, el) => {
      const a = $(el).find('h2 a').first();
      const title = a.text().trim();
      const url = a.attr('href') || '';
      const snippet = $(el).find('p.s').text().trim();
      if (title && url && /^https?:/.test(url)) sources.push({ url, title, snippet: snippet.slice(0, 300) });
    });
    const clean = sources.filter((s) => !isGarbageUrl(s.url) && !isGarbageText(s.title, s.snippet));
    if (!clean.length) throw new WebError(WEB_ERRORS.PROVIDER_ERROR, 'mojeek empty');
    return { sources: clean };
  },
};

export const bingProvider = {
  id: 'bing', name: 'Bing', keyless: true,
  configured: () => true,
  async search(req) {
    const res = await fetchWithFallback(
      `https://www.bing.com/search?q=${encodeURIComponent(req.query)}`,
      { 'User-Agent': BROWSER_UA }, 8000,
    );
    if (!res) throw new WebError(WEB_ERRORS.PROVIDER_ERROR, 'bing blocked');
    const $ = cheerio.load(await res.text());
    const sources = [];
    $('li.b_algo').slice(0, 8).each((_, el) => {
      const a = $(el).find('h2 a').first();
      const title = a.text().trim();
      const url = a.attr('href') || '';
      const snippet = $(el).find('.b_caption p').first().text().trim();
      if (title && url && /^https?:/.test(url)) sources.push({ url, title, snippet: snippet.slice(0, 300) });
    });
    const clean = sources.filter((s) => !isGarbageUrl(s.url) && !isGarbageText(s.title, s.snippet));
    if (!clean.length) throw new WebError(WEB_ERRORS.PROVIDER_ERROR, 'bing empty');
    return { sources: clean };
  },
};

const SEARX_INSTANCES = ['https://search.sapti.me', 'https://searx.be', 'https://search.bus-hit.me', 'https://paulgo.io', 'https://priv.au', 'https://opnxng.com'];

export const searxngProvider = {
  id: 'searxng', name: 'SearXNG', keyless: true,
  configured: () => true,
  async search(req) {
    // All instances in parallel — take the healthiest pool (instances rotate).
    const attempts = SEARX_INSTANCES.map(async (instance) => {
      try {
        const url = `${instance}/search?q=${encodeURIComponent(req.query)}&format=json`;
        const res = await fetchWithFallback(url, { 'User-Agent': 'Mozilla/5.0' }, 6000);
        if (!res) throw new Error('blocked');
        const data = await res.json();
        if (!data?.results?.length) throw new Error('empty');
        return data.results.slice(0, 8).map((r) => ({ url: r.url, title: r.title, snippet: String(r.content || '').slice(0, 300) }));
      } catch { return null; }
    });
    const pools = (await Promise.all(attempts)).filter((p) => p && p.length);
    if (!pools.length) throw new WebError(WEB_ERRORS.PROVIDER_ERROR, 'searxng: no instance answered');
    pools.sort((a, b) => b.length - a.length);
    const clean = pools[0].filter((s) => !isGarbageUrl(s.url) && !isGarbageText(s.title, s.snippet));
    if (!clean.length) throw new WebError(WEB_ERRORS.PROVIDER_ERROR, 'searxng empty');
    return { sources: clean };
  },
};

export const wikipediaProvider = {
  id: 'wikipedia', name: 'Wikipedia', keyless: true,
  configured: () => true,
  async search(req) {
    const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(req.query)}&format=json&srlimit=5`;
    const res = await fetch(url, { headers: { 'User-Agent': 'JEXI-OS/1.0 (research agent)' }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new WebError(WEB_ERRORS.PROVIDER_ERROR, `wikipedia ${res.status}`);
    const data = await res.json();
    const sources = (data?.query?.search || []).map((r) => ({
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(String(r.title).replace(/ /g, '_'))}`,
      title: r.title,
      snippet: String(r.snippet || '').replace(/<[^>]+>/g, '').slice(0, 300),
    }));
    if (!sources.length) throw new WebError(WEB_ERRORS.PROVIDER_ERROR, 'wikipedia empty');
    return { sources };
  },
};

export const arxivProvider = {
  id: 'arxiv', name: 'arXiv', keyless: true, academicOnly: true,
  configured: () => true,
  async search(req) {
    const url = `http://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(req.query)}&max_results=4`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new WebError(WEB_ERRORS.PROVIDER_ERROR, `arxiv ${res.status}`);
    const $ = cheerio.load(await res.text(), { xml: true });
    const sources = [];
    $('entry').each((_, el) => {
      const title = $(el).find('title').text().trim().replace(/\n/g, ' ');
      const id = $(el).find('id').text().trim();
      const snippet = $(el).find('summary').text().trim().replace(/\n/g, ' ').slice(0, 300);
      if (title && id) sources.push({ url: id, title, snippet });
    });
    if (!sources.length) throw new WebError(WEB_ERRORS.PROVIDER_ERROR, 'arxiv empty');
    return { sources };
  },
};

/* ══════════════════ DATACENTER-PROOF KEYLESS ENGINES ════════════════════
 * HTML engines block datacenter IPs (the old Wikipedia-flood bug). These
 * five are real APIs/RSS that answer from ANY IP with no key — they keep
 * JEXI's net over the WHOLE internet even from Render. */

export const googleNewsRssProvider = {
  id: 'google-news', name: 'Google News', keyless: true,
  configured: () => true,
  async search(req) {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(req.query)}&hl=en-US&gl=US&ceid=US:en`;
    const res = await fetch(url, { headers: { 'User-Agent': BROWSER_UA }, signal: AbortSignal.timeout(9000) });
    if (!res.ok) throw new WebError(WEB_ERRORS.PROVIDER_ERROR, `google-news ${res.status}`);
    const xml = await res.text();
    // Google News links are news.google.com/rss/articles redirects that open
    // the real article in a browser; the <source> tag names the publisher.
    const sources = [...xml.matchAll(/<item>[\s\S]*?<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>[\s\S]*?<link>(?:<!\[CDATA\[)?(https?:\/\/[^\s<]+)[\s\S]*?(?:<source[^>]*>([^<]*)<\/source>)?[\s\S]*?<\/item>/g)]
      .slice(0, 8)
      .map((m) => ({
        url: m[2],
        title: String(m[1]).replace(/\s+/g, ' ').trim(),
        snippet: m[3] ? `via ${String(m[3]).trim()}` : undefined,
      }))
      .filter((x) => x.title && x.title.length > 12);
    if (!sources.length) throw new WebError(WEB_ERRORS.PROVIDER_ERROR, 'google-news empty');
    return { sources };
  },
};

export const marginaliaProvider = {
  id: 'marginalia', name: 'Marginalia', keyless: true,
  configured: () => true,
  async search(req) {
    const url = `https://old-search.marginalia.nu/search?query=${encodeURIComponent(req.query)}`;
    const res = await fetch(url, { headers: { 'User-Agent': BROWSER_UA }, signal: AbortSignal.timeout(9000) });
    if (!res.ok) throw new WebError(WEB_ERRORS.PROVIDER_ERROR, `marginalia ${res.status}`);
    const $ = cheerio.load(await res.text());
    const sources = [];
    $('a[href^="http"]').slice(0, 40).each((_, el) => {
      const link = $(el).attr('href');
      const title = $(el).text().trim();
      if (title.length > 8 && !link.includes('marginalia') && !isGarbageUrl(link)) sources.push({ url: link, title });
    });
    if (!sources.length) throw new WebError(WEB_ERRORS.PROVIDER_ERROR, 'marginalia empty');
    return { sources: sources.slice(0, 6) };
  },
};

export const ddgInstantProvider = {
  id: 'ddg-instant', name: 'DDG Answers', keyless: true,
  configured: () => true,
  async search(req) {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(req.query)}&format=json&no_html=1&no_redirect=1`;
    const res = await fetch(url, { headers: { 'User-Agent': BROWSER_UA }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new WebError(WEB_ERRORS.PROVIDER_ERROR, `ddg-instant ${res.status}`);
    const data = await res.json();
    const sources = [];
    if (data.AbstractURL && data.Abstract) sources.push({ url: data.AbstractURL, title: data.Heading || data.AbstractSource, snippet: String(data.Abstract).slice(0, 300) });
    for (const t of (data.RelatedTopics || [])) {
      const u = t.FirstURL || (t.Topics && t.Topics[0] && t.Topics[0].FirstURL);
      const txt = t.Text || (t.Topics && t.Topics[0] && t.Topics[0].Text);
      if (u && txt) sources.push({ url: u, title: String(txt).split(' - ')[0].slice(0, 120), snippet: String(txt).slice(0, 200) });
      if (sources.length >= 6) break;
    }
    const clean = sources.filter((x) => !isGarbageUrl(x.url));
    if (!clean.length) throw new WebError(WEB_ERRORS.PROVIDER_ERROR, 'ddg-instant empty');
    return { sources: clean };
  },
};

export const hnSearchProvider = {
  id: 'hackernews', name: 'Hacker News', keyless: true,
  configured: () => true,
  async search(req) {
    const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(req.query)}&hitsPerPage=5`;
    const res = await fetch(url, { headers: { 'User-Agent': BROWSER_UA }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new WebError(WEB_ERRORS.PROVIDER_ERROR, `hn ${res.status}`);
    const data = await res.json();
    const sources = (data.hits || [])
      .filter((h) => h.url)
      .map((h) => ({ url: h.url, title: h.title || h.story_title, snippet: `discussed on Hacker News · ${h.points || 0} points · ${h.num_comments || 0} comments` }));
    if (!sources.length) throw new WebError(WEB_ERRORS.PROVIDER_ERROR, 'hn empty');
    return { sources: sources.filter((x) => !isGarbageUrl(x.url)) };
  },
};

export const openAlexProvider = {
  id: 'openalex', name: 'OpenAlex', keyless: true, academicOnly: true,
  configured: () => true,
  async search(req) {
    const url = `https://api.openalex.org/works?search=${encodeURIComponent(req.query)}&per-page=5`;
    const res = await fetch(url, { headers: { 'User-Agent': 'JEXI-OS/1.0 (research agent; mailto:research@jexi.os)' }, signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new WebError(WEB_ERRORS.PROVIDER_ERROR, `openalex ${res.status}`);
    const data = await res.json();
    const sources = (data.results || []).map((w) => ({
      url: w.doi || w.id,
      title: (w.title || '').slice(0, 200),
      snippet: w.publication_year ? `${w.type || 'paper'} · ${w.publication_year}${w.cited_by_count ? ` · ${w.cited_by_count} citations` : ''}` : undefined,
      ...(w.publication_date ? { publishedAt: w.publication_date } : {}),
    }));
    if (!sources.length) throw new WebError(WEB_ERRORS.PROVIDER_ERROR, 'openalex empty');
    return { sources };
  },
};

/* ══════════════════ DSH TRIO — keyed providers (exact mirrors) ═══════════ */

/**
 * dsh web-search-deepseek: POST {base}/messages (Anthropic-compatible) with
 * the native web_search_20250305 server tool. STRICT: no
 * web_search_tool_result block → WEB_PROVIDER_ERROR (never prose-scrape).
 * Citations (cited_text) are joined to sources by URL.
 */
export const deepseekSearchProvider = {
  id: 'deepseek-official', name: 'DeepSeek Search', keyless: false,
  envKey: 'DEEPSEEK_API_KEY',
  baseURL: () => process.env.DEEPSEEK_SEARCH_BASE_URL || 'https://api.deepseek.com/anthropic/v1',
  model: () => process.env.DEEPSEEK_SEARCH_MODEL || 'deepseek-v4-flash',
  configured() { return !!keyFor(this.envKey); },
  async search(req, signal) {
    const apiKey = keyFor(this.envKey);
    if (!apiKey) throw new WebError(WEB_ERRORS.CREDENTIAL_MISSING, 'DEEPSEEK_API_KEY not set');
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
    }).catch((e) => { throw new WebError(WEB_ERRORS.PROVIDER_ERROR, `deepseek search: ${e.message}`); });
    if (!res.ok) throw new WebError(WEB_ERRORS.PROVIDER_ERROR, `deepseek search HTTP ${res.status}`);
    const data = await res.json().catch(() => { throw new WebError(WEB_ERRORS.PROVIDER_ERROR, 'deepseek search: bad json'); });
    // Two-pass mapping (dsh): pass 1 collects result items AND citation
    // excerpts (blocks may arrive in any order); pass 2 joins them by URL.
    const byUrl = new Map();
    const citations = new Map(); // url → cited_text
    for (const block of data.content || []) {
      if (block.type === 'web_search_tool_result') {
        for (const item of block.content || []) {
          if (item.url && !byUrl.has(item.url)) {
            byUrl.set(item.url, { url: item.url, title: item.title || undefined, ...(item.page_age ? { publishedAt: item.page_age } : {}) });
          }
        }
      } else if (block.type === 'text') {
        for (const c of block.citations || []) {
          if (c.url && c.cited_text && !citations.has(c.url)) citations.set(c.url, String(c.cited_text).slice(0, 300));
        }
      }
    }
    for (const [url, excerpt] of citations) {
      const src = byUrl.get(url);
      if (src && !src.snippet) src.snippet = excerpt;
    }
    if (!byUrl.size) throw new WebError(WEB_ERRORS.PROVIDER_ERROR, 'deepseek search: no web_search_tool_result block (strict mode)');
    return { sources: [...byUrl.values()].filter((s) => !isGarbageUrl(s.url)) };
  },
};

/** dsh web-search-exa: POST {base}/search with numResults. */
export const exaProvider = {
  id: 'exa', name: 'Exa', keyless: false,
  envKey: 'EXA_API_KEY',
  baseURL: () => process.env.EXA_BASE_URL || 'https://api.exa.ai',
  configured() { return !!keyFor(this.envKey); },
  async search(req, signal) {
    const apiKey = keyFor(this.envKey);
    if (!apiKey) throw new WebError(WEB_ERRORS.CREDENTIAL_MISSING, 'EXA_API_KEY not set');
    const res = await httpCall(`${this.baseURL()}/search`, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({ query: req.query, numResults: req.maxResults ?? 8, type: 'auto' }),
    }).catch((e) => { throw new WebError(WEB_ERRORS.PROVIDER_ERROR, `exa: ${e.message}`); });
    if (!res.ok) throw new WebError(WEB_ERRORS.PROVIDER_ERROR, `exa HTTP ${res.status}`);
    const data = await res.json().catch(() => { throw new WebError(WEB_ERRORS.PROVIDER_ERROR, 'exa: bad json'); });
    const sources = (data.results || []).map((r) => ({ url: r.url, title: r.title || undefined, snippet: r.text ? String(r.text).slice(0, 300) : undefined, ...(r.publishedDate ? { publishedAt: r.publishedDate } : {}) }));
    if (!sources.length) throw new WebError(WEB_ERRORS.PROVIDER_ERROR, 'exa empty');
    return { sources: sources.filter((s) => !isGarbageUrl(s.url)) };
  },
};

/** dsh web-search-perplexity: OpenAI-compatible /chat/completions, model sonar;
 *  citations → sources; the generated answer rides as `content`. */
export const perplexityProvider = {
  id: 'perplexity', name: 'Perplexity', keyless: false,
  envKey: 'PERPLEXITY_API_KEY',
  baseURL: () => process.env.PERPLEXITY_BASE_URL || 'https://api.perplexity.ai',
  model: () => process.env.PERPLEXITY_MODEL || 'sonar',
  configured() { return !!keyFor(this.envKey); },
  async search(req, signal) {
    const apiKey = keyFor(this.envKey);
    if (!apiKey) throw new WebError(WEB_ERRORS.CREDENTIAL_MISSING, 'PERPLEXITY_API_KEY not set');
    const res = await httpCall(`${this.baseURL()}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({ model: this.model(), messages: [{ role: 'user', content: req.query }] }),
    }).catch((e) => { throw new WebError(WEB_ERRORS.PROVIDER_ERROR, `perplexity: ${e.message}`); });
    if (!res.ok) throw new WebError(WEB_ERRORS.PROVIDER_ERROR, `perplexity HTTP ${res.status}`);
    const data = await res.json().catch(() => { throw new WebError(WEB_ERRORS.PROVIDER_ERROR, 'perplexity: bad json'); });
    const content = data?.choices?.[0]?.message?.content || undefined;
    const raw = data?.search_results?.map((r) => ({ url: r.url, title: r.title || undefined }))
      ?? (data?.citations || []).map((u) => ({ url: u }));
    const sources = (raw || []).filter((s) => s.url && !isGarbageUrl(s.url));
    if (!sources.length && !content) throw new WebError(WEB_ERRORS.PROVIDER_ERROR, 'perplexity empty');
    return { ...(content ? { content } : {}), sources };
  },
};

/* ══════════════════ THE SEAM (ctx.web port) ══════════════════════════════ */

/** Registry + order. Keyed DSH providers first WHEN configured; the keyless
 *  whole-web engines always follow — search works with zero keys. */
export const SEARCH_PROVIDERS = [
  deepseekSearchProvider, exaProvider, perplexityProvider,   // DSH trio (keyed)
  googleNewsRssProvider, ddgInstantProvider, marginaliaProvider, hnSearchProvider, // datacenter-proof
  ddgHtmlProvider, ddgLiteProvider, mojeekProvider, bingProvider, searxngProvider, // HTML engines
  wikipediaProvider, arxivProvider, openAlexProvider,        // verticals
];

const COOLDOWN_MS = 10 * 60 * 1000;
const FAIL_LIMIT = 3;
const health = new Map(); // id → { fails, until }

function available(p, { includeAcademic = false } = {}) {
  if (p.academicOnly && !includeAcademic) return false;
  if (!p.configured()) return false;
  const h = health.get(p.id);
  if (h && h.until > Date.now()) return false;
  return true;
}

function noteSuccess(id) { health.delete(id); }
function noteFailure(id, err) {
  const h = health.get(id) || { fails: 0, until: 0 };
  h.fails += 1;
  h.lastError = String((err && err.message) || err || 'unknown').slice(0, 200);
  h.lastErrorAt = new Date().toISOString();
  if (h.fails >= FAIL_LIMIT) { h.until = Date.now() + COOLDOWN_MS; h.fails = 0; }
  health.set(id, h);
}

/** Health snapshot for /api/settings/status + the UI. */
export function webSearchHealth() {
  return SEARCH_PROVIDERS.map((p) => {
    const h = health.get(p.id);
    return {
      id: p.id, name: p.name, free: !!p.keyless,
      env: p.keyless ? null : p.envKey,
      configured: p.configured(),
      cooling: !!(h && h.until > Date.now()),
      cooldownLeftSec: h && h.until > Date.now() ? Math.ceil((h.until - Date.now()) / 1000) : 0,
      ...(h && h.lastError ? { lastError: h.lastError, lastErrorAt: h.lastErrorAt } : {}),
    };
  });
}

/**
 * THE seam call (ctx.web.search). One provider, DSH contract: dedupe by URL,
 * truncate to maxResults, never throw for soft emptiness — providers throw
 * WebError; the seam catches and reports it in `error`.
 */
export async function providerSearch(providerId, req, { signal } = {}) {
  const p = SEARCH_PROVIDERS.find((x) => x.id === providerId);
  if (!p) throw new WebError(WEB_ERRORS.PROVIDER_ERROR, `unknown provider ${providerId}`);
  try {
    const out = await p.search({ query: String(req.query || ''), ...(req.maxResults ? { maxResults: req.maxResults } : {}) }, signal);
    noteSuccess(p.id);
    const seen = new Set();
    const sources = [];
    for (const s of out.sources || []) {
      const c = canonicalUrl(s.url);
      if (!c || seen.has(c)) continue;
      seen.add(c);
      sources.push({ ...s, url: s.url });
      if (req.maxResults && sources.length >= req.maxResults) break;
    }
    return {
      ...(out.content ? { content: out.content } : {}),
      sources,
      ...(req.maxResults && (out.sources || []).length > sources.length ? { truncated: true } : {}),
    };
  } catch (e) {
    const isWeb = e instanceof WebError;
    noteFailure(p.id, e);
    if (signal && signal.aborted) throw new WebError(WEB_ERRORS.ABORTED, 'aborted');
    throw isWeb ? e : new WebError(WEB_ERRORS.PROVIDER_ERROR, (e && e.message) || String(e));
  }
}

/** Which providers would run for a query right now (for streaming). */
export function activeSearchProviders(opts) {
  return SEARCH_PROVIDERS.filter((p) => available(p, opts));
}

/** Test hooks: garbage filter + health reset. */
export { isGarbageUrl };
export function __resetHealth() { health.clear(); }

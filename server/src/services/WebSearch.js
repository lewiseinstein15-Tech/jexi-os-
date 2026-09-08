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
 *   MESH    exa-anon / parallel / anysearch — premium engines on ANONYMOUS
 *           tiers (live-verified Sept 2026, no signup); commoncrawl (the
 *           archive, domain queries); dynamic SearXNG rotation (self-healing
 *           instance discovery instead of a hardcoded list).
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
import { loadSettings } from './SettingsManager.js'; // B166b — Settings keys reach the next search

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
  TAVILY_API_KEY: ['tavily_api_key', 'tavilykey', 'tavily'],
  BRAVE_API_KEY: ['brave_api_key', 'bravekey', 'brave'],
  FIRECRAWL_API_KEY: ['firecrawl_api_key', 'firecrawlkey', 'firecrawl'],
  PARALLEL_API_KEY: ['parallel_api_key', 'parallelkey', 'parallel'],
  ANYSEARCH_API_KEY: ['anysearch_api_key', 'anysearchkey', 'anysearch'],
};

function keyFor(envName) {
  const names = [envName.toLowerCase(), ...(KEY_ALIASES[envName] || [])];
  for (const n of names) {
    try { const v = resolveCredential(n); if (v) return v; } catch { /* store absent */ }
  }
  // B166b — keys pasted in Settings (or installed via the settings API)
  // reach the NEXT search without a restart.
  try {
    const st = loadSettings() || {};
    const camel = envName.toLowerCase().replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    if (st[camel]) return String(st[camel]);
    for (const n of names) if (st[n]) return String(st[n]);
  } catch { /* settings absent */ }
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

// Static fallback — public instances rot constantly (2/2 probed dead Sept
// 2026), so the live list below is preferred whenever it answers.
const SEARX_STATIC = ['https://search.sapti.me', 'https://searx.be', 'https://search.bus-hit.me', 'https://paulgo.io', 'https://priv.au', 'https://opnxng.com'];
/** Parse searx.space/instances.json → healthy main instance base URLs. Pure (tested). */
export function __parseSearxInstances(data) {
  const out = [];
  for (const [u, v] of Object.entries((data && data.instances) || {})) {
    try {
      if (v && v.http && v.http.status_code === 200 && v.main && !(v.timing && v.timing.search && v.timing.search.error)) out.push(String(u).replace(/\/+$/, ''));
    } catch { /* malformed entry — skip */ }
  }
  return out;
}
let __searxCache = { at: 0, instances: [] };
async function discoverSearxInstances() {
  if (__searxCache.instances.length && Date.now() - __searxCache.at < 3600_000) return __searxCache.instances;
  try {
    const res = await httpCall('https://searx.space/data/instances.json', { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`searx.space ${res.status}`);
    const found = __parseSearxInstances(await res.json()).slice(0, 12);
    if (found.length >= 3) { __searxCache = { at: Date.now(), instances: found }; return found; }
  } catch { /* fall through to static */ }
  return SEARX_STATIC;
}

export const searxngProvider = {
  id: 'searxng', name: 'SearXNG', keyless: true,
  configured: () => true,
  async search(req) {
    // Live-discovered instances in parallel — take the healthiest pool.
    const instances = await discoverSearxInstances();
    const attempts = instances.map(async (instance) => {
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

/* ══════════════════ FREE-TIER SEARCH APIS (email signup only, NO card) ═══
 * Tavily: 1,000 searches/month free — purpose-built for AI agents.
 * Brave:  2,000 searches/month free — independent index.
 * Paste the key in Settings (or env) and these join the rotation per call. */

export const tavilyProvider = {
  id: 'tavily', name: 'Tavily', keyless: false,
  envKey: 'TAVILY_API_KEY',
  configured() { return !!keyFor(this.envKey); },
  async search(req, signal) {
    const apiKey = keyFor(this.envKey);
    if (!apiKey) throw new WebError(WEB_ERRORS.CREDENTIAL_MISSING, 'TAVILY_API_KEY not set (free at app.tavily.com — 1,000/month, no card)');
    const res = await httpCall('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      signal,
      body: JSON.stringify({ query: req.query, max_results: req.maxResults ?? 8, search_depth: 'basic' }),
    }).catch((e) => { throw new WebError(WEB_ERRORS.PROVIDER_ERROR, `tavily: ${e.message}`); });
    if (!res.ok) throw new WebError(WEB_ERRORS.PROVIDER_ERROR, `tavily HTTP ${res.status}`);
    const data = await res.json().catch(() => { throw new WebError(WEB_ERRORS.PROVIDER_ERROR, 'tavily: bad json'); });
    const sources = (data.results || []).map((r) => ({ url: r.url, title: r.title, snippet: r.content ? String(r.content).slice(0, 300) : undefined, ...(r.published_date ? { publishedAt: r.published_date } : {}) }));
    if (!sources.length) throw new WebError(WEB_ERRORS.PROVIDER_ERROR, 'tavily empty');
    return { ...(data.answer ? { content: String(data.answer).slice(0, 2000) } : {}), sources: sources.filter((x) => !isGarbageUrl(x.url)) };
  },
};

export const braveProvider = {
  id: 'brave', name: 'Brave Search', keyless: false,
  envKey: 'BRAVE_API_KEY',
  configured() { return !!keyFor(this.envKey); },
  async search(req, signal) {
    const apiKey = keyFor(this.envKey);
    if (!apiKey) throw new WebError(WEB_ERRORS.CREDENTIAL_MISSING, 'BRAVE_API_KEY not set (free at brave.com/search/api — 2,000/month, no card)');
    const res = await httpCall(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(req.query)}&count=${req.maxResults ?? 8}`, {
      headers: { Accept: 'application/json', 'X-Subscription-Token': apiKey },
      signal,
    }).catch((e) => { throw new WebError(WEB_ERRORS.PROVIDER_ERROR, `brave: ${e.message}`); });
    if (!res.ok) throw new WebError(WEB_ERRORS.PROVIDER_ERROR, `brave HTTP ${res.status}`);
    const data = await res.json().catch(() => { throw new WebError(WEB_ERRORS.PROVIDER_ERROR, 'brave: bad json'); });
    const sources = (data?.web?.results || []).map((r) => ({
      url: r.url, title: r.title,
      snippet: r.description ? String(r.description).replace(/<[^>]+>/g, '').slice(0, 300) : undefined,
      ...(r.age ? { publishedAt: r.age } : {}),
    }));
    if (!sources.length) throw new WebError(WEB_ERRORS.PROVIDER_ERROR, 'brave empty');
    return { sources: sources.filter((x) => !isGarbageUrl(x.url)) };
  },
};

export const stackoverflowProvider = {
  id: 'stackoverflow', name: 'Stack Overflow', keyless: true,
  configured: () => true,
  async search(req) {
    // Free Stack Exchange API — datacenter-friendly, no key, no card. Empty
    // for non-code questions, so it self-regulates out of the rotation.
    const url = `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=${encodeURIComponent(req.query)}&site=stackoverflow&pagesize=6&filter=!nNPvSNVZBP`; // title+link+score+tags
    const res = await fetch(url, { headers: { 'User-Agent': BROWSER_UA }, signal: AbortSignal.timeout(9000) });
    if (!res.ok) throw new WebError(WEB_ERRORS.PROVIDER_ERROR, `stackoverflow ${res.status}`);
    const data = await res.json();
    const sources = (data.items || []).map((q) => ({
      url: q.link,
      title: String(q.title || '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&'),
      snippet: `score ${q.score} · ${q.is_answered ? 'answered' : 'unanswered'} · ${(q.tags || []).slice(0, 4).join(', ')}`,
    }));
    if (!sources.length) throw new WebError(WEB_ERRORS.PROVIDER_ERROR, 'stackoverflow empty');
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

/* ══════════ KEYLESS PREMIUM MESH (verified live, Sept 2026) ══════════
 * Three premium engines serve ANONYMOUS tiers over plain HTTPS POST in
 * MCP/JSON-RPC wire format (no MCP SDK needed): Exa (mcp.exa.ai), Parallel
 * (search.parallel.ai), AnySearch (api.anysearch.com). All LIVE-PROBED from
 * this repo 2026-09-08 (fresh Sept-2026 news returned, zero signup).
 * Parallel/AnySearch accept an optional Bearer key (same endpoint) for
 * higher quotas. Exa-anon NEVER sends the key: the keyed Exa REST leg
 * already spends it, and fan-out would otherwise double-bill every search.
 */

async function mcpToolsCall(url, tool, args, { apiKey = '', signal } = {}) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const res = await httpCall(url, {
    method: 'POST', headers, signal: signal || AbortSignal.timeout(25000),
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } }),
  }).catch((e) => { throw new WebError(WEB_ERRORS.PROVIDER_ERROR, `mcp ${tool}: ${e.message}`); });
  const raw = await res.text().catch(() => '');
  if (!res.ok) throw new WebError(WEB_ERRORS.PROVIDER_ERROR, `mcp ${tool} HTTP ${res.status}: ${raw.slice(0, 120)}`);
  return raw;
}

/** MCP tools/call envelope → first text block. Accepts pure JSON
 *  (Parallel/AnySearch) or SSE event-stream (Exa: `data: {...}` lines). */
export function mcpFirstText(raw) {
  const t = String(raw || '');
  const datas = [...t.matchAll(/^data:\s*(\{.*\})\s*$/gm)].map((m) => m[1]);
  const payload = datas.length ? datas[datas.length - 1] : t;
  let d;
  try { d = JSON.parse(payload); } catch { throw new WebError(WEB_ERRORS.PROVIDER_ERROR, 'mcp: bad envelope'); }
  if (d && d.error) throw new WebError(WEB_ERRORS.PROVIDER_ERROR, `mcp: ${d.error.message || d.error.code || 'error'}`);
  const content = (d && d.result && d.result.content) || [];
  const text = content.filter((c) => c && c.type === 'text' && c.text).map((c) => c.text).join('\n');
  if (!text.trim()) throw new WebError(WEB_ERRORS.PROVIDER_ERROR, 'mcp: empty content');
  if (/^error executing tool/i.test(text.trim())) throw new WebError(WEB_ERRORS.PROVIDER_ERROR, `mcp tool: ${text.trim().slice(0, 160)}`);
  return text;
}

/** Exa MCP text → sources. Blocks look like:
 *  Title: …\nURL: https://…\nPublished: …\nAuthor: …\nHighlights:\n… */
export function parseExaSearchText(text) {
  const out = [];
  for (const b of String(text || '').split(/\n(?=Title: )/)) {
    const url = ((b.match(/^URL:\s*(\S+)/m) || [])[1] || '').trim();
    if (!url || !/^https?:\/\//.test(url)) continue;
    const title = (((b.match(/^Title:\s*(.+)$/m) || [])[1]) || url).trim();
    const pub = (((b.match(/^Published:\s*(\S+)/m) || [])[1]) || '').trim();
    const snippet = b.split('\n')
      .map((l) => l.trim().replace(/^-\s+/, ''))
      .filter((l) => l && !/^(Title|URL|Published|Author|Highlights):/i.test(l) && !/^#+\s/.test(l) && l.length > 20)
      .join(' ').replace(/\s+/g, ' ').trim().slice(0, 300);
    out.push({ url, title, ...(snippet ? { snippet } : {}), ...(pub ? { publishedAt: pub } : {}) });
  }
  return out;
}

/** AnySearch `search` markdown → sources. Shape:
 *  ## Search Results (N results…)\n### 1. Title\n- **URL**: …\n- snippet… */
export function parseAnysearchResults(text) {
  const out = [];
  for (const chunk of String(text || '').split(/\n### \d+\.\s+/)) {
    if (!chunk.trim() || !chunk.includes('**URL**')) continue;
    const lines = chunk.split('\n').map((l) => l.trim()).filter(Boolean);
    const title = (lines[0] || '').replace(/^#+\s*/, '').trim();
    const urlLine = lines.find((l) => l.includes('**URL**')) || '';
    const url = ((urlLine.match(/\*\*URL\*\*:\s*(\S+)/) || [])[1] || '').trim();
    if (!url || !/^https?:\/\//.test(url)) continue;
    const snippet = lines.filter((l) => l !== lines[0] && l !== urlLine).map((l) => l.replace(/^-\s+/, '')).join(' ').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim().slice(0, 300);
    out.push({ url, title: title || url, ...(snippet ? { snippet } : {}) });
  }
  return out;
}

/** Parallel MCP text (a JSON string with search_id/results[]) → sources. */
export function parseParallelResults(text) {
  let d;
  try { d = JSON.parse(String(text || '')); } catch { throw new WebError(WEB_ERRORS.PROVIDER_ERROR, 'parallel: bad payload'); }
  return ((d && d.results) || []).map((r) => ({
    url: r.url,
    title: r.title || r.url,
    ...((r.excerpts || []).length ? { snippet: r.excerpts.join(' ').slice(0, 300) } : {}),
    ...(r.publish_date ? { publishedAt: r.publish_date } : {}),
  })).filter((s) => s.url && /^https?:\/\//.test(s.url));
}

export const exaAnonProvider = {
  id: 'exa-anon', name: 'Exa Free', keyless: true,
  configured: () => true,
  async search(req, signal) {
    const raw = await mcpToolsCall('https://mcp.exa.ai/mcp', 'web_search_exa', { query: req.query, numResults: req.maxResults ?? 8 }, { signal });
    const sources = parseExaSearchText(mcpFirstText(raw)).filter((x) => !isGarbageUrl(x.url) && !isGarbageText(x.title, x.snippet));
    if (!sources.length) throw new WebError(WEB_ERRORS.PROVIDER_ERROR, 'exa-anon empty');
    return { sources };
  },
};

export const parallelProvider = {
  id: 'parallel', name: 'Parallel', keyless: true,
  configured: () => true,
  async search(req, signal) {
    const key = keyFor('PARALLEL_API_KEY'); // optional: higher quota, same endpoint
    const raw = await mcpToolsCall('https://search.parallel.ai/mcp', 'web_search',
      { objective: req.query, search_queries: [req.query], max_results: req.maxResults ?? 8 }, { apiKey: key, signal });
    const sources = parseParallelResults(mcpFirstText(raw)).filter((x) => !isGarbageUrl(x.url) && !isGarbageText(x.title, x.snippet));
    if (!sources.length) throw new WebError(WEB_ERRORS.PROVIDER_ERROR, 'parallel empty');
    return { sources };
  },
};

export const anysearchProvider = {
  id: 'anysearch', name: 'AnySearch', keyless: true,
  configured: () => true,
  async search(req, signal) {
    const key = keyFor('ANYSEARCH_API_KEY'); // optional: higher quota, same endpoint
    const raw = await mcpToolsCall('https://api.anysearch.com/mcp', 'search', { query: req.query }, { apiKey: key, signal });
    const sources = parseAnysearchResults(mcpFirstText(raw)).filter((x) => !isGarbageUrl(x.url) && !isGarbageText(x.title, x.snippet));
    if (!sources.length) throw new WebError(WEB_ERRORS.PROVIDER_ERROR, 'anysearch empty');
    return { sources };
  },
};

/** Full-page extraction: AnySearch `extract` (anonymous) → Jina Reader
 *  (keyless). Returns { url, title, markdown, via } or null. */
export async function extractPageContent(url, { timeoutMs = 25000 } = {}) {
  const target = String(url || '');
  if (!/^https?:\/\//.test(target)) return null;
  const signal = AbortSignal.timeout(timeoutMs); // one shared budget for both legs
  try {
    const raw = await mcpToolsCall('https://api.anysearch.com/mcp', 'extract', { url: target }, { apiKey: keyFor('ANYSEARCH_API_KEY'), signal });
    const d = JSON.parse(mcpFirstText(raw)); // {"url","title","content"}
    if (d && d.content && String(d.content).length > 100) {
      return { url: d.url || target, title: d.title || '', markdown: String(d.content).slice(0, 8000), via: 'anysearch' };
    }
  } catch { /* fall through to Jina */ }
  try {
    const res = await httpCall(`https://r.jina.ai/${target}`, { headers: { 'User-Agent': BROWSER_UA }, signal });
    if (!res.ok) return null;
    const md = await res.text();
    if (!md || md.length < 200) return null;
    return { url: target, title: '', markdown: md.slice(0, 8000), via: 'jina' };
  } catch { return null; }
}

/* ══════════ COMMON CRAWL (the archive — any page that ever existed) ══════ */

let __ccCache = { at: 0, index: '' };
async function ccLatestIndex() {
  if (__ccCache.index && Date.now() - __ccCache.at < 24 * 3600_000) return __ccCache.index;
  const res = await httpCall('https://index.commoncrawl.org/collinfo.json', { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new WebError(WEB_ERRORS.PROVIDER_ERROR, `commoncrawl collinfo ${res.status}`);
  const list = await res.json();
  const id = list && list[0] && list[0].id;
  if (!id) throw new WebError(WEB_ERRORS.PROVIDER_ERROR, 'commoncrawl: no index listed');
  __ccCache = { at: Date.now(), index: `https://index.commoncrawl.org/${id}-index` };
  return __ccCache.index;
}

/** Domain-ish substring in a query (the archive is keyword-blind). Pure (tested). */
export function ccDomainFromQuery(q) {
  const m = String(q || '').match(/([a-z0-9-]+\.)+[a-z]{2,}/i);
  return m ? m[0].toLowerCase() : '';
}

export const commoncrawlProvider = {
  id: 'commoncrawl', name: 'Common Crawl', keyless: true,
  configured: () => true,
  async search(req) {
    const domain = ccDomainFromQuery(req.query);
    if (!domain) throw new WebError(WEB_ERRORS.PROVIDER_ERROR, 'commoncrawl: needs a domain (keyword-blind archive)');
    const idx = await ccLatestIndex();
    const res = await httpCall(`${idx}?url=${encodeURIComponent(domain)}/*&output=json&filter=status:200&limit=8`, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new WebError(WEB_ERRORS.PROVIDER_ERROR, `commoncrawl ${res.status}`);
    const sources = (await res.text()).trim().split('\n').filter(Boolean).map((l) => {
      try {
        const r = JSON.parse(l);
        return { url: r.url, title: r.url, snippet: `${r.timestamp || ''} · ${r.mime || ''} · archived`.trim() };
      } catch { return null; }
    }).filter((x) => x && !isGarbageUrl(x.url));
    if (!sources.length) throw new WebError(WEB_ERRORS.PROVIDER_ERROR, 'commoncrawl empty');
    return { sources };
  },
};

/* ══════════ FIRECRAWL (keyed REST — 1,000 credits/mo free, no card) ══════ */

export const firecrawlProvider = {
  id: 'firecrawl', name: 'Firecrawl', keyless: false,
  envKey: 'FIRECRAWL_API_KEY',
  configured() { return !!keyFor(this.envKey); },
  async search(req, signal) {
    const apiKey = keyFor(this.envKey);
    if (!apiKey) throw new WebError(WEB_ERRORS.CREDENTIAL_MISSING, 'FIRECRAWL_API_KEY not set (free at firecrawl.dev — 1,000/month, no card)');
    const res = await httpCall('https://api.firecrawl.dev/v1/search', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({ query: req.query, limit: req.maxResults ?? 8 }),
    }).catch((e) => { throw new WebError(WEB_ERRORS.PROVIDER_ERROR, `firecrawl: ${e.message}`); });
    if (!res.ok) throw new WebError(WEB_ERRORS.PROVIDER_ERROR, `firecrawl HTTP ${res.status}`);
    const data = await res.json().catch(() => { throw new WebError(WEB_ERRORS.PROVIDER_ERROR, 'firecrawl: bad json'); });
    const sources = ((data && (data.data || data.results)) || []).map((r) => ({
      url: r.url, title: r.title || r.url,
      snippet: r.description ? String(r.description).slice(0, 300) : undefined,
      ...(r.publishedDate ? { publishedAt: r.publishedDate } : {}),
    }));
    if (!sources.length) throw new WebError(WEB_ERRORS.PROVIDER_ERROR, 'firecrawl empty');
    return { sources: sources.filter((x) => !isGarbageUrl(x.url)) };
  },
};

/* ══════════════════ THE SEAM (ctx.web port) ══════════════════════════════ */

/** Registry + order. Keyed DSH providers first WHEN configured; the keyless
 *  whole-web engines always follow — search works with zero keys. */
export const SEARCH_PROVIDERS = [
  tavilyProvider, braveProvider, firecrawlProvider,           // free-tier keyed APIs
  deepseekSearchProvider, exaProvider, perplexityProvider,   // DSH trio (paid keys)
  exaAnonProvider, parallelProvider, anysearchProvider,       // keyless premium mesh
  googleNewsRssProvider, ddgInstantProvider, marginaliaProvider, hnSearchProvider, // datacenter-proof
  ddgHtmlProvider, ddgLiteProvider, mojeekProvider, bingProvider, searxngProvider, // HTML engines
  wikipediaProvider, arxivProvider, openAlexProvider, stackoverflowProvider, commoncrawlProvider, // verticals + archive
];

const COOLDOWN_MS = 10 * 60 * 1000;
const FAIL_LIMIT = 3;
const health = new Map(); // id → { fails, until }
// Free-quota brake: a leg that somehow serves 500 calls in one day sits out
// until tomorrow (a runaway loop must never burn a whole free month in hours).
const DAILY_BUDGET = 500;
const __calls = new Map(); // id → { day, n }
function __today() { return new Date().toISOString().slice(0, 10); }
export function __noteCall(id) {
  const day = __today();
  const e = __calls.get(id);
  if (!e || e.day !== day) __calls.set(id, { day, n: 1 });
  else e.n += 1;
}
export function callsToday(id) {
  const e = __calls.get(id);
  return e && e.day === __today() ? e.n : 0;
}
export function __resetBudgets() { __calls.clear(); }

function available(p, { includeAcademic = false } = {}) {
  if (p.academicOnly && !includeAcademic) return false;
  if (!p.configured()) return false;
  if (callsToday(p.id) >= DAILY_BUDGET) return false;
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
  // 401/402 are ACCOUNT problems (bad key / no credit), not transient: retrying
  // every 10 minutes just burns a model turn. Cool down for 6 hours instead.
  const permanent = /HTTP 40[12]/.test(h.lastError);
  if (permanent) {
    h.until = Date.now() + 6 * 60 * 60 * 1000;
    h.fails = 0;
    h.actionNeeded = h.lastError.includes('402') ? 'add credit to this provider account' : 'check the API key';
  } else if (h.fails >= FAIL_LIMIT) {
    h.until = Date.now() + COOLDOWN_MS;
    h.fails = 0;
  }
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
      callsToday: callsToday(p.id),
      cooling: !!(h && h.until > Date.now()),
      cooldownLeftSec: h && h.until > Date.now() ? Math.ceil((h.until - Date.now()) / 1000) : 0,
      ...(h && h.lastError ? { lastError: h.lastError, lastErrorAt: h.lastErrorAt } : {}),
      ...(h && h.actionNeeded ? { actionNeeded: h.actionNeeded } : {}),
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
  __noteCall(p.id);
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

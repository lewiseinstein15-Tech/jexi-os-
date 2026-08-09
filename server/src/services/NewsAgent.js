import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import { generateContent } from './LLMClient.js';
import { saveInternetKnowledge } from './MemoryManager.js';
import { JEXI_SYSTEM_PROMPT } from './JexiPrompt.js';
import { twitterLatest } from './TrustedLibrary.js';

/**
 * NEWS AGENT — the specialist news team (patterns from ai-news-agent, RSSHub,
 * Miniflux/FreshRSS, and the MBFC credibility dataset):
 *
 *   News Scout → News Filter → News Editor
 *
 * Free and keyless: Google News RSS (with freshness operators + topic feeds),
 * BBC, CNN, Al Jazeera RSS — fetched in parallel with a proxy fallback for
 * datacenter IPs. X/Twitter is a parallel best-effort (Nitter is largely dead
 * in 2026 — X requires login, so this never blocks the team).
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';

/** Direct fetch first, then a server-side proxy (datacenter IPs get blocked). */
async function fetchWithFallback(url, timeoutMs) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(timeoutMs) });
    if (res.ok) return await res.text();
  } catch (e) {}
  try {
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
    const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(timeoutMs + 6000) });
    if (res.ok) return await res.text();
  } catch (e) {}
  return null;
}

/* ---------------- tiny TTL cache (news moves fast — 2 min) ---------------- */
const cache = new Map();
const CACHE_MS = 2 * 60 * 1000;

function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const promise = fn().catch((e) => { cache.delete(key); throw e; });
  cache.set(key, { at: Date.now(), value: promise });
  return promise;
}

function cleanHtml(s) {
  return String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

async function parseRss(url) {
  const xml = await fetchWithFallback(url, 8000);
  if (!xml) return [];
  const $ = cheerio.load(xml, { xml: true });
  const items = [];
  $('item').each((i, el) => {
    const title = cleanHtml($(el).find('title').text());
    const link = $(el).find('link').text().trim();
    const snippet = cleanHtml($(el).find('description').text()).slice(0, 300);
    const date = cleanHtml($(el).find('pubDate').text());
    if (title && link) items.push({ title, link, snippet, date, source: sourceNameFromUrl(url) });
  });
  return items;
}

function sourceNameFromUrl(url) {
  try { return new URL(url).hostname.replace(/^www\./, '').replace(/\.(com|org|net|co\.uk|uk|io)$/i, '').split('.')[0]; } catch (e) { return 'Feed'; }
}

/* ---------------- STAGE 1 — NEWS SCOUT: which feeds to read ---------------- */
const TOPIC_FEEDS = {
  technology: 'TECHNOLOGY', tech: 'TECHNOLOGY', crypto: 'TECHNOLOGY', ai: 'TECHNOLOGY',
  artificial: 'TECHNOLOGY', intelligence: 'TECHNOLOGY', robot: 'TECHNOLOGY', software: 'TECHNOLOGY',
  business: 'BUSINESS', economy: 'BUSINESS', finance: 'BUSINESS', stock: 'BUSINESS',
  world: 'WORLD', international: 'WORLD', sports: 'SPORTS', football: 'SPORTS', soccer: 'SPORTS',
  science: 'SCIENCE', space: 'SCIENCE', health: 'HEALTH', medical: 'HEALTH', covid: 'HEALTH',
  entertainment: 'ENTERTAINMENT', celebrity: 'ENTERTAINMENT', movies: 'ENTERTAINMENT', music: 'ENTERTAINMENT',
};

function detectTopic(query) {
  const q = String(query || '').toLowerCase();
  for (const [word, topic] of Object.entries(TOPIC_FEEDS)) {
    if (q.includes(word)) return topic;
  }
  return null;
}

async function scoutFeeds(query) {
  const topic = detectTopic(query);
  const feeds = [
    // Google News: search with 1-day freshness operator (avoids the ~6-day-deep RSS bias)
    `https://news.google.com/rss/search?q=${encodeURIComponent(`${query} when:1d`)}&hl=en-US&gl=US&ceid=US:en`,
    // Google News: top stories
    'https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en',
    // BBC world + tech
    'https://feeds.bbci.co.uk/news/world/rss.xml',
    'https://feeds.bbci.co.uk/news/technology/rss.xml',
    // CNN + Al Jazeera (canonical URLs, no redirect wrapper)
    'http://rss.cnn.com/rss/edition.rss',
    'https://www.aljazeera.com/xml/rss/all.rss',
  ];
  if (topic) feeds.push(`https://news.google.com/rss/headlines/section/topic/${topic}?hl=en-US&gl=US&ceid=US:en`);

  const settled = await Promise.allSettled(feeds.map((f) => parseRss(f)));
  const items = [];
  for (const res of settled) {
    if (res.status === 'fulfilled') items.push(...res.value);
  }
  return items;
}

/* ---------------- STAGE 2 — NEWS FILTER: dedupe + credibility + rank ---------------- */
// Compact credibility table (drawn from the public MBFC-derived dataset —
// factual rating + political bias for major outlets). Unknown domains default
// to mixed/unknown and simply rank lower — they are never silently dropped.
const CREDIBILITY = {
  'reuters.com': ['high', 'center'], 'apnews.com': ['high', 'center'], 'bbc.com': ['high', 'center'],
  'bbc.co.uk': ['high', 'center'], 'nytimes.com': ['high', 'left-center'], 'wsj.com': ['high', 'right-center'],
  'theguardian.com': ['high', 'left-center'], 'washingtonpost.com': ['high', 'left-center'],
  'cnn.com': ['high', 'left-center'], 'aljazeera.com': ['high', 'center'], 'npr.org': ['high', 'center'],
  'cbsnews.com': ['high', 'center'], 'abcnews.go.com': ['high', 'center'], 'nbcnews.com': ['high', 'left-center'],
  'politico.com': ['high', 'center'], 'thehill.com': ['high', 'center'], 'bloomberg.com': ['high', 'center'],
  'ft.com': ['high', 'center'], 'economist.com': ['high', 'center'], 'cnbc.com': ['high', 'center'],
  'theverge.com': ['high', 'center'], 'techcrunch.com': ['high', 'center'], 'arstechnica.com': ['high', 'center'],
  'wired.com': ['high', 'center'], 'nature.com': ['high', 'center'], 'science.org': ['high', 'center'],
  'statnews.com': ['high', 'center'], 'espn.com': ['high', 'center'], 'sky.com': ['high', 'center'],
  'time.com': ['high', 'center'], 'newyorker.com': ['high', 'left-center'], 'theatlantic.com': ['high', 'left-center'],
  'telegraph.co.uk': ['high', 'right-center'], 'thetimes.co.uk': ['high', 'right-center'],
  'independent.co.uk': ['mixed', 'left-center'], 'forbes.com': ['mixed', 'center'],
  'businessinsider.com': ['mixed', 'center'], 'usatoday.com': ['mixed', 'center'], 'newsweek.com': ['mixed', 'center'],
  'engadget.com': ['mixed', 'center'], 'zdnet.com': ['mixed', 'center'], 'mashable.com': ['mixed', 'center'],
  'gizmodo.com': ['mixed', 'left-center'], 'vox.com': ['mixed', 'left-center'], 'slate.com': ['mixed', 'left'],
  'huffpost.com': ['mixed', 'left'], 'msnbc.com': ['mixed', 'left'], 'foxnews.com': ['mixed', 'right-center'],
  'dailymail.co.uk': ['mixed', 'right'], 'mirror.co.uk': ['mixed', 'left-center'], 'thesun.co.uk': ['low', 'right'],
};

export function credibilityFor(host) {
  const h = String(host || '').replace(/^www\./, '').toLowerCase();
  return CREDIBILITY[h] || ['mixed', 'unknown'];
}

function normalizeUrl(url) {
  return String(url || '')
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '')
    .replace(/[?&](utm_[^&]*|fbclid|gclid)[^&]*/g, '')
    .replace(/^news\.google\.com\/rss\/articles.*/, 'google-news')
    .toLowerCase();
}

const STOP = new Set(['the', 'a', 'an', 'to', 'of', 'in', 'on', 'at', 'for', 'and', 'with', 'from', 'by', 'is', 'are', 'was', 'be', 'it', 'this', 'that', 'as', 'after', 'over', 'up', 'down', 'new', 'first', 'says', 'say', 'said', 'us', 'uk']);

function titleWords(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

/** Jaccard similarity of two titles — the same story from two outlets merges. */
function titleSimilarity(a, b) {
  const wa = titleWords(a);
  const wb = titleWords(b);
  if (!wa.length || !wb.length) return 0;
  const sa = new Set(wa);
  const inter = wb.filter((w) => sa.has(w)).length;
  const union = new Set([...wa, ...wb]).size;
  return union ? inter / union : 0;
}

export function filterNews(items, query) {
  // 1. Drop junk, keep items with real links
  const valid = items.filter((n) => n.title && n.link && !/google\.com\/rss\/articles|^\/\//.test(n.link));

  // 2. Group by normalized URL
  const byUrl = new Map();
  for (const n of valid) {
    const key = normalizeUrl(n.link);
    if (!byUrl.has(key)) byUrl.set(key, []);
    byUrl.get(key).push(n);
  }

  // 3. Merge same-URL duplicates and near-identical titles (Jaccard >= 0.55)
  const groups = [];
  for (const group of byUrl.values()) {
    let merged = false;
    for (const g of groups) {
      if (titleSimilarity(group[0].title, g[0].title) >= 0.55) {
        g.push(...group);
        merged = true;
        break;
      }
    }
    if (!merged) groups.push([...group]);
  }

  // 4. Per group: keep the most credible source, combine source names
  const deduped = groups.map((group) => {
    group.sort((a, b) => {
      const [fa] = credibilityFor(new URL(a.link).hostname);
      const [fb] = credibilityFor(new URL(b.link).hostname);
      return (fb === 'high') - (fa === 'high');
    });
    const best = group[0];
    const hosts = [...new Set(group.map((n) => { try { return new URL(n.link).hostname.replace(/^www\./, ''); } catch (e) { return ''; } }).filter(Boolean))];
    const [factual, bias] = credibilityFor(hosts[0] || '');
    return { ...best, sources: hosts, factual, bias };
  });

  // 5. Rank: credibility + recency + relevance to the question + entity boost
  const terms = String(query || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3);
  const entities = [...new Set(String(query || '').replace(/[^a-zA-Z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && /^[A-Z]/.test(w)))];
  const now = Date.now();

  const scored = deduped.map((n) => {
    let score = n.factual === 'high' ? 3 : n.factual === 'mixed' ? 1 : 0;
    const ageMs = n.date ? now - new Date(n.date).getTime() : 0;
    if (!n.date || ageMs < 24 * 3600 * 1000) score += 2;
    else if (ageMs < 48 * 3600 * 1000) score += 1;
    const blob = `${n.title} ${n.snippet || ''}`.toLowerCase();
    for (const t of terms) if (blob.includes(t)) score += 1;
    for (const e of entities) if (blob.includes(e.toLowerCase())) score += 3;
    return { ...n, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 12);
}

/* ---------------- STAGE 3 — NEWS EDITOR: cited digest ---------------- */
function headlineFallback(query, items, twitterItems) {
  const lines = items.slice(0, 8).map((n, i) => `${i + 1}. **${n.title}** — ${(n.sources || [n.source]).join(', ')}${n.date ? ` (${String(n.date).slice(0, 16)})` : ''}\n   ${n.link}`).join('\n');
  return (
    `### 📰 JEXI OS — LATEST NEWS\n\n` +
    `${twitterItems.length ? `**X/Twitter needs login** (X has no free API) — here are the top headlines instead:\n\n` : ''}` +
    `${lines || 'No headlines found right now — try again in a minute.'}`
  );
}

export async function editNews(query, items, twitterItems) {
  const numbered = items
    .slice(0, 10)
    .map((n, i) => `[${i + 1}] ${n.title} — ${(n.sources || [n.source]).join(', ')} (factual: ${n.factual}${n.bias !== 'unknown' ? `, bias: ${n.bias}` : ''})${n.date ? ` | ${String(n.date).slice(0, 16)}` : ''}\n    ${n.link}`)
    .join('\n');
  const twBlock = twitterItems.length
    ? `\n\nRecent X/Twitter posts (unverified, treat with care):\n${twitterItems.slice(0, 5).map((t) => `- ${t.snippet || t.title}`).join('\n')}`
    : '';

  const prompt =
    `The user asked about the latest news: "${query}"\n\n` +
    `These are the freshest headlines my sources returned, with credibility tags:\n\n${numbered}${twBlock}\n\n` +
    `Write a structured news digest. RULES:\n` +
    `1. Report ONLY what the headlines actually say — never invent details.\n` +
    `2. Cite each story with its number, e.g. [1] or [3], after the headline.\n` +
    `3. Structure: "## TOP STORIES" (numbered, each cited, one line of what's happening per story), then "## WHY IT MATTERS" (2-4 sentence synthesis), then "### Sources" (markdown links of ONLY the cited stories).\n` +
    `4. Prefer high-factual sources when they cover the same story.\n` +
    `5. If there are no headlines, say exactly: "I could not find fresh headlines right now — try again in a few minutes."`;

  let summary;
  try {
    summary = await generateContent(prompt, JEXI_SYSTEM_PROMPT, null, { temperature: 0.3 });
  } catch (e) {
    summary = headlineFallback(query, items, twitterItems);
  }
  if (!summary || summary.trim().length < 40) summary = headlineFallback(query, items, twitterItems);

  // Post-validation: drop citation markers that don't match a real story
  const valid = new Set(items.slice(0, 10).map((_, i) => String(i + 1)));
  summary = String(summary).replace(/\[(\d+)\]/g, (m, n) => (valid.has(n) ? m : ''));
  return summary;
}

/* ---------------- THE TEAM ---------------- */
export async function runNewsTeam(query, sendEvent) {
  // 1. News Scout — parallel feeds (X/Twitter best-effort runs alongside, never blocks)
  sendEvent?.('log', { agent: 'News Scout', message: `📡 Scanning trusted news feeds for: "${query}"` });
  const [rawItems, tw] = await Promise.allSettled([
    cached(`news:${query.toLowerCase()}`, () => scoutFeeds(query)),
    cached(`tw:${query.toLowerCase()}`, () => twitterLatest(query)),
  ]);
  const items = rawItems.status === 'fulfilled' ? rawItems.value : [];
  const twitterItems = tw.status === 'fulfilled' && tw.value ? tw.value.items : [];
  sendEvent?.('log', { agent: 'News Scout', message: `🔎 Gathered ${items.length} headlines from ${new Set(items.map((n) => n.source)).size} feeds.` });
  if (twitterItems.length) sendEvent?.('log', { agent: 'News Scout', message: `🐦 ${twitterItems.length} recent X/Twitter posts (best-effort).` });
  else sendEvent?.('log', { agent: 'News Scout', message: '🐦 X/Twitter needs login — no public feed available (using trusted news feeds).' });

  // 2. News Filter — dedupe, credibility, rank
  sendEvent?.('log', { agent: 'News Filter', message: '🧹 Deduplicating and tagging source credibility...' });
  const top = filterNews(items, query);
  sendEvent?.('log', { agent: 'News Filter', message: `✅ ${top.length} distinct stories — ${top.filter((n) => n.factual === 'high').length} from high-factual outlets.` });

  // 3. News Editor — cited digest
  sendEvent?.('log', { agent: 'News Editor', message: '✍️ Writing the digest...' });
  const summary = await editNews(query, top, twitterItems);

  const sources = top.slice(0, 8).map((n) => ({ title: n.title, link: n.link, source: (n.sources || []).join(', ') }));
  for (const s of sources) {
    try {
      let host = '';
      try { host = new URL(s.link).hostname; } catch (e) {}
      sendEvent?.('website', { site: { title: s.title, url: s.link, favicon: `https://www.google.com/s2/favicons?domain=${host}&sz=64`, status: 'success' } });
    } catch (e) {}
  }

  try { saveInternetKnowledge(String(query).slice(0, 200), summary, sources.map((s) => s.title)); } catch (e) {}
  return { summary, sources, confidence: top.length >= 4 ? 88 : 80 };
}

import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import { isSSRF } from './Security.js';
import { extractPdfText } from './Extractor.js';

/**
 * JEXI OS Trusted Library
 * -----------------------
 * The "training data" layer — free, legal, no-API-key sources that JEXI reads
 * from herself, like how big AI companies train on books & papers:
 *   - Wikipedia      → trusted overviews
 *   - Project Gutenberg → full public-domain BOOKS (whole texts)
 *   - arXiv          → academic papers (PDF)
 *   - Open Library   → book finder (titles/authors)
 * Plus a live-news layer (Google News + BBC RSS) and best-effort Twitter/X
 * (Nitter instances — X has no free API, so this is a graceful best effort).
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';

/* ---------------- Tiny TTL cache (per-instance) ----------------
 * Makes repeat questions INSTANT instead of re-hitting every upstream API.
 * Caches the in-flight promise too, so two identical questions arriving at
 * the same moment share ONE upstream call instead of two.
 */
const ttlCache = new Map();

async function cachedAsync(key, ttlMs, fn) {
  const now = Date.now();
  const hit = ttlCache.get(key);
  if (hit && now - hit.at < ttlMs) return hit.value;
  const promise = fn().catch((e) => { ttlCache.delete(key); throw e; });
  ttlCache.set(key, { at: now, value: promise });
  return promise;
}

const CACHE_NEWS_MS = 2 * 60 * 1000;        // news moves fast — 2 min
const CACHE_BOOKS_MS = 6 * 60 * 60 * 1000;  // study topics — 6 h
const CACHE_BOOK_TEXT_MS = 24 * 60 * 60 * 1000; // downloaded texts — 24 h

async function getJSON(url, timeout = 8000) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function getText(url, timeout = 20000) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/* ---------------- WIKIPEDIA (trusted overview) ---------------- */
async function wikipediaOverview(topic) {
  try {
    const data = await getJSON(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(topic)}&format=json&srlimit=2`);
    const first = data?.query?.search?.[0];
    if (!first) return null;
    const title = first.title;
    const sum = await getJSON(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`, 6000);
    const extract = (sum.extract || '').slice(0, 4000);
    if (extract.length < 100) return null;
    return {
      title: `Wikipedia — ${title}`,
      url: sum.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
      snippet: extract.slice(0, 500),
      type: 'overview',
      source: 'Wikipedia',
    };
  } catch (e) { return null; }
}

/* ---------------- PROJECT GUTENBERG (full public-domain books) ---------------- */
async function gutenbergBook(topic) {
  try {
    const data = await getJSON(`https://gutendex.com/books?search=${encodeURIComponent(topic)}&languages=en`);
    const book = (data?.results || []).find(b => b.formats?.['text/plain; charset=utf-8'] || b.formats?.['text/plain']) || data?.results?.[0];
    if (!book) return null;
    const url = book.formats?.['text/plain; charset=utf-8'] || book.formats?.['text/plain'];
    if (!url) return null;
    return {
      title: `Gutenberg — ${String(book.title).slice(0, 90)}`,
      url,
      snippet: (book.summaries?.[0] || 'Public-domain classic — full text available.').slice(0, 500),
      type: 'book',
      source: 'Project Gutenberg',
    };
  } catch (e) { return null; }
}

/* ---------------- ARXIV (academic papers, PDF) ---------------- */
async function arxivPapers(topic) {
  try {
    const xml = await getText(`http://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(topic)}&max_results=2`, 8000);
    const $ = cheerio.load(xml, { xml: true });
    const out = [];
    $('entry').each((i, el) => {
      const title = $(el).find('title').text().trim().replace(/\s+/g, ' ');
      const id = $(el).find('id').text().trim();
      if (!title || !id) return;
      out.push({
        title: `arXiv — ${title.slice(0, 120)}`,
        url: `${id.replace(/abs\//, 'pdf/')}.pdf`,
        snippet: $(el).find('summary').text().trim().replace(/\s+/g, ' ').slice(0, 500),
        type: 'paper',
        source: 'arXiv',
      });
    });
    return out;
  } catch (e) { return []; }
}

/* ---------------- OPEN LIBRARY (book finder) ---------------- */
async function openLibrary(topic) {
  try {
    const data = await getJSON(`https://openlibrary.org/search.json?q=${encodeURIComponent(topic)}&limit=3&fields=title,author_name,first_publish_year`);
    const out = [];
    for (const d of (data.docs || []).slice(0, 2)) {
      if (!d.title) continue;
      out.push({
        title: `Open Library — ${d.title}`,
        url: `https://openlibrary.org/search?q=${encodeURIComponent(d.title)}`,
        snippet: `${d.author_name?.[0] || 'Unknown author'} · ${d.first_publish_year || 'year unknown'}`,
        type: 'book',
        source: 'Open Library',
      });
    }
    return out;
  } catch (e) { return []; }
}

/** Search every trusted free book source for a topic (parallel, resilient). */
export async function searchTrustedBooks(topic) {
  return cachedAsync(`books:${topic}`, CACHE_BOOKS_MS, async () => {
    const [wiki, guten, arxiv, openlib] = await Promise.all([
      wikipediaOverview(topic),
      gutenbergBook(topic),
      arxivPapers(topic),
      openLibrary(topic),
    ]);
    return [wiki, guten, ...arxiv, ...openlib].filter(Boolean);
  });
}

/** Download & read a trusted book/paper/overview by URL, capped at maxChars. */
export async function getTrustedBookText(url, maxChars = 80000) {
  return cachedAsync(`book:${url}:${maxChars}`, CACHE_BOOK_TEXT_MS, async () => {
    if (await isSSRF(url)) throw new Error('Security blocked (SSRF)');
    const lower = url.toLowerCase();
    let text;
    if (lower.endsWith('.pdf') || lower.includes('filetype=pdf')) {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      text = await extractPdfText(await res.arrayBuffer());
    } else if (lower.endsWith('.txt') || lower.includes('gutenberg.org')) {
      text = await getText(url, 25000);
    } else {
      const { extractContent } = await import('./Extractor.js');
      text = (await extractContent(url)).content;
    }
    return String(text || '').slice(0, maxChars);
  });
}

/* ---------------- LATEST NEWS (trusted feeds, no keys) ---------------- */
function cleanHtml(s) {
  return String(s || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
}

async function parseRss(url, limit = 12) {
  const xml = await getText(url, 10000);
  const $ = cheerio.load(xml, { xml: true });
  const items = [];
  $('item').each((i, el) => {
    if (items.length >= limit) return;
    const title = $(el).find('title').text().trim();
    const link = $(el).find('link').text().trim();
    const date = $(el).find('pubDate').text().trim();
    const snippet = cleanHtml($(el).find('description').text()).slice(0, 300);
    const src = $(el).find('source').text().trim();
    if (title && link) {
      items.push({
        title,
        link,
        source: src || (() => { try { return new URL(link).hostname.replace('www.', ''); } catch (e) { return 'news'; } })(),
        snippet,
        date,
      });
    }
  });
  return items;
}

/** Top headlines for a query from Google News + BBC (deduped, trusted). */
export async function latestNews(query, limit = 10) {
  return cachedAsync(`news:${query}:${limit}`, CACHE_NEWS_MS, async () => {
    const feeds = [
      `https://news.google.com/rss/search?q=${encodeURIComponent(query || 'top stories')}&hl=en&gl=US&ceid=US:en`,
      'http://feeds.bbci.co.uk/news/world/rss.xml',
    ];
    const results = [];
    for (const feed of feeds) {
      try { results.push(...(await parseRss(feed, limit))); } catch (e) {}
      if (results.length >= limit) break;
    }
    const seen = new Set();
    return results.filter(r => {
      if (seen.has(r.link)) return false;
      seen.add(r.link);
      return true;
    }).slice(0, limit);
  });
}

/* ---------------- TWITTER / X (best effort — no free API) ---------------- */
const NITTER_INSTANCES = ['https://nitter.net', 'https://nitter.poast.org', 'https://nitter.privacyredirect.com', 'https://xcancel.com'];

/** Try to read public X/Twitter posts for a query via Nitter RSS. Returns null if unreachable. */
export async function twitterLatest(query, limit = 8) {
  return cachedAsync(`twitter:${query}:${limit}`, CACHE_NEWS_MS, async () => {
    for (const base of NITTER_INSTANCES) {
      try {
        const res = await fetch(`${base}/search/rss?q=${encodeURIComponent(query)}&f=tweets`, {
          headers: { 'User-Agent': UA },
          signal: AbortSignal.timeout(7000),
        });
        if (!res.ok) continue;
        const xml = await res.text();
        if (!xml.includes('<item>')) continue;
        const $ = cheerio.load(xml, { xml: true });
        const items = [];
        $('item').each((i, el) => {
          if (items.length >= limit) return;
          const title = $(el).find('title').text().trim();
          const link = $(el).find('link').text().trim();
          const desc = cleanHtml($(el).find('description').text());
          if (title || desc) items.push({ title: title || desc.slice(0, 80), link, snippet: desc.slice(0, 280), source: 'X/Twitter' });
        });
        if (items.length) return { instance: base, items };
      } catch (e) {}
    }
    return null;
  });
}

import fetch from 'node-fetch';
import * as cheerio from 'cheerio';

// Domains we never surface (ads, spam, login walls, low-quality aggregators)
const BAD_DOMAINS = ['pinterest.com', 'facebook.com', 'instagram.com', 'tiktok.com', 'quora.com', 'reddit.com', 'medium.com', 'w3schools.com', 'spammy', 'adf.ly', 'bit.ly'];
const BAD_SNIPPET_MARKERS = ['cookie', 'sign up', 'subscribe to', 'advertisement', 'sponsored'];

// Domains we rank above others (trusted, high-quality)
const TRUSTED_DOMAINS = ['wikipedia.org', '.edu', '.gov', '.org', 'arxiv.org', 'github.com', 'mdn.', 'developer.', 'stackoverflow.com', 'geeksforgeeks.org', 'khanacademy.org', 'britannica.com', 'coursera.org', 'mit.edu', 'stanford.edu', 'openstax.org', 'docs.'];
const TRUSTED_LABELS = ['wikipedia', 'official', 'documentation', 'docs', 'university', '.edu', '.gov', 'arxiv', 'github', 'khan', 'britannica', 'openstax'];

function isGarbage(r) {
  const blob = `${r.title} ${r.snippet || ''}`.toLowerCase();
  if (BAD_SNIPPET_MARKERS.some(m => blob.includes(m))) return true;
  try {
    const host = new URL(r.link).hostname;
    if (BAD_DOMAINS.some(d => host.includes(d) || host === d)) return true;
    if (r.link.includes('ad_domain=') || host === 'duckduckgo.com') return true; // DDG ad redirects
  } catch (e) { return true; }
  return false;
}

function trustedScore(r) {
  let score = 0;
  try {
    const url = r.link.toLowerCase();
    const host = new URL(r.link).hostname;
    if (TRUSTED_DOMAINS.some(d => host.includes(d) || url.includes(d))) score += 3;
    const blob = `${r.title} ${r.snippet || ''}`.toLowerCase();
    if (TRUSTED_LABELS.some(l => blob.includes(l))) score += 1;
    if (url.startsWith('https://')) score += 1;
  } catch (e) {}
  return score;
}

function extractCoreQuery(query) {
  if (query.includes(':')) return query;
  let q = query.toLowerCase();
  q = q.replace(/[^a-z0-9\s]/g, ' ');
  const stopWords = new Set(['research', 'the', 'how', 'to', 'explain', 'step', 'by', 'look', 'for', 'computer', 'science', 'video', 'lectures', 'github', 'repositories', 'notes', 'tutorial', 'do', 'on', 'this', 'unit', 'in', 'is', 'name', 'go', 'learn', 'everything', 'about', 'create', 'detailed', 'and', 'it', 'works', 'what', 'why', 'please', 'give', 'me', 'can', 'you', 'i', 'need', 'used', 'modern', 'with', 'code', 'implementations', 'its', 'a', 'an', 'of', 'mechanism', 'visit', 'following', 'url', 'https', 'www', 'build', 'make', 'build me', 'app', 'application', 'website', 'system', 'me', 'please']);
  const words = q.split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w));
  return words.slice(0, 8).join(' ');
}

async function fetchSearXNG(query, category = 'general') {
  const instances = ['https://search.sapti.me', 'https://searx.be', 'https://search.bus-hit.me', 'https://paulgo.io'];
  for (const instance of instances) {
    try {
      const url = `${instance}/search?q=${encodeURIComponent(query)}&format=json&categories=${category}`;
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(6000) });
      if (!res.ok) continue;
      const data = await res.json();
      if (data?.results?.length > 0) {
        return data.results.slice(0, 8).map(r => ({ title: r.title, link: r.url, snippet: r.content, source: 'SearXNG' })).filter(r => !isGarbage(r));
      }
    } catch (e) {}
  }
  return [];
}

async function fetchDDG(query) {
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36' }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`DDG ${res.status}`);
    const $ = cheerio.load(await res.text());
    const results = [];
    $('.result').slice(0, 8).each((i, el) => {
      const title = $(el).find('.result__a').text().trim();
      let link = $(el).find('.result__a').attr('href') || '';
      const uddg = link.match(/uddg=([^&]+)/);
      if (uddg) link = decodeURIComponent(uddg[1]);
      const snippet = $(el).find('.result__snippet').text().trim();
      if (title && link) results.push({ title, link, snippet, source: 'DuckDuckGo' });
    });
    return results.filter(r => !isGarbage(r));
  } catch (e) { return []; }
}

async function fetchBing(query) {
  try {
    const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36' }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`Bing ${res.status}`);
    const $ = cheerio.load(await res.text());
    const results = [];
    $('li.b_algo').slice(0, 8).each((i, el) => {
      const a = $(el).find('h2 a').first();
      const title = a.text().trim();
      const link = a.attr('href') || '';
      const snippet = $(el).find('.b_caption p').first().text().trim();
      if (title && link && !link.includes('bing.com')) results.push({ title, link, snippet, source: 'Bing' });
    });
    return results.filter(r => !isGarbage(r));
  } catch (e) { return []; }
}

/** arXiv is for academic queries only — consumer/product questions must not
 *  be polluted by research-paper PDFs that merely share keywords. */
const ACADEMIC_MARKERS = /\b(paper|arxiv|study|survey|thesis|journal|algorithm|theory|methodology|scientific|experiment|dataset|preprint|research paper)\b/i;
export function isAcademicQuery(query) {
  return ACADEMIC_MARKERS.test(String(query || ''));
}

async function fetchArxiv(query) {
  try {
    const url = `http://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&max_results=4`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const $ = cheerio.load(await res.text(), { xml: true });
    const results = [];
    $('entry').each((i, el) => {
      const title = $(el).find('title').text().trim().replace(/\n/g, ' ');
      const id = $(el).find('id').text().trim().replace(/abs\//, 'pdf/');
      const snippet = $(el).find('summary').text().trim().replace(/\n/g, ' ').slice(0, 300);
      if (title && id) results.push({ title, link: id + '.pdf', snippet, source: 'arXiv' });
    });
    return results;
  } catch (e) { return []; }
}

export async function aggregateSearch(query, specificEngine = null) {
  const coreQuery = extractCoreQuery(query);
  if (!coreQuery) return [];

  const wantArxiv = isAcademicQuery(coreQuery);
  const engines = {
    searx: fetchSearXNG(coreQuery, 'general'),
    ddg: fetchDDG(coreQuery),
    bing: fetchBing(coreQuery),
    ...(wantArxiv ? { arxiv: fetchArxiv(coreQuery) } : {}),
  };

  let combined;
  if (specificEngine === 'videos') {
    combined = await fetchSearXNG(coreQuery, 'videos');
  } else if (specificEngine && engines[specificEngine]) {
    combined = await engines[specificEngine];
  } else {
    const [searx, ddg, bing, arxiv = []] = await Promise.all([engines.searx, engines.ddg, engines.bing, engines.arxiv || Promise.resolve([])]);
    combined = [...(wantArxiv ? arxiv : []), ...searx, ...ddg, ...bing];
  }

  // Dedupe by link, then rank: trusted first, then by source
  const seen = new Set();
  const unique = combined.filter(r => {
    if (!r.link || seen.has(r.link)) return false;
    seen.add(r.link);
    return true;
  });

  unique.sort((a, b) => trustedScore(b) - trustedScore(a) || 0);
  return unique.slice(0, 10);
}

export async function researchTopic(query, sendEvent) {
  sendEvent('log', { agent: 'Researcher', message: `Learning how to: ${query}` });
  const sources = await aggregateSearch(`how to ${query}`);
  const knowledge = sources.map(s => `- ${s.title}: ${s.snippet}`).join('\n');
  return { knowledge, sources, summary: `Learned from ${sources.length} resources.` };
}

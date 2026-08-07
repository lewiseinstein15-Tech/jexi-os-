import fetch from 'node-fetch';
import * as cheerio from 'cheerio';

const BAD_DOMAINS = ['scribd.com', 'pinterest.com', 'facebook.com', 'instagram.com', 'tiktok.com', 'quora.com'];

function extractCoreQuery(query) {
  // If the query contains advanced search operators (like filetype:), don't sanitize it!
  if (query.includes(':')) return query;
  
  let q = query.toLowerCase();
  q = q.replace(/[^a-z0-9\s]/g, ' ');
  const stopWords = new Set(['research', 'the', 'how', 'to', 'explain', 'step', 'by', 'look', 'for', 'computer', 'science', 'video', 'lectures', 'github', 'repositories', 'notes', 'tutorial', 'do', 'on', 'this', 'unit', 'in', 'is', 'name', 'go', 'learn', 'everything', 'about', 'create', 'detailed', 'and', 'it', 'works', 'what', 'why', 'please', 'give', 'me', 'can', 'you', 'i', 'need', 'used', 'modern', 'with', 'code', 'implementations', 'its', 'a', 'an', 'of', 'mechanism', 'visit', 'following', 'url', 'https', 'www', 'build', 'make', 'build me', 'app', 'application', 'website', 'system']);
  const words = q.split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w));
  return words.slice(0, 6).join(' ');
}

async function fetchSearXNG(query, category = 'general') {
  const instances = ['https://search.sapti.me', 'https://searx.be', 'https://search.bus-hit.me'];
  for (const instance of instances) {
    try {
      const url = `${instance}/search?q=${encodeURIComponent(query)}&format=json&categories=${category}`;
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(5000) });
      if (!res.ok) continue;
      const data = await res.json();
      if (data?.results?.length > 0) {
        return data.results.slice(0, 5).map(r => {
          const isBad = BAD_DOMAINS.some(d => r.url.includes(d));
          if (isBad) return null;
          return { title: r.title, link: r.url, snippet: r.content, source: category === 'videos' ? 'YouTube' : 'Web' };
        }).filter(Boolean);
      }
    } catch (e) {}
  }
  return [];
}

async function fetchDDG(query) {
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36' }});
    if (!res.ok) throw new Error(`DDG Status ${res.status}`);
    const $ = cheerio.load(await res.text());
    const results = [];
    $(".result").slice(0, 5).each((i, el) => {
      const title = $(el).find(".result__a").text().trim();
      let link = $(el).find(".result__a").attr("href") || "";
      const uddg = link.match(/uddg=([^&]+)/);
      if (uddg) link = decodeURIComponent(uddg[1]);
      const snippet = $(el).find(".result__snippet").text().trim();
      if (title && link && snippet) results.push({ title, link, snippet, source: 'DuckDuckGo' });
    });
    return results;
  } catch (e) { return []; }
}

// NEW: arXiv API for academic papers
async function fetchArxiv(query) {
  try {
    const url = `http://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&max_results=3`;
    const res = await fetch(url);
    const xml = await res.text();
    const $ = cheerio.load(xml, { xml: true });
    const results = [];
    $('entry').each((i, el) => {
      const title = $(el).find('title').text().trim().replace(/\n/g, ' ');
      const link = $(el).find('id').text().trim().replace(/abs\//, 'pdf/');
      const snippet = $(el).find('summary').text().trim().replace(/\n/g, ' ');
      if (title && link) results.push({ title, link: link + '.pdf', snippet, source: 'arXiv' });
    });
    return results;
  } catch (e) { return []; }
}

export async function aggregateSearch(query, specificEngine = null) {
  const coreQuery = extractCoreQuery(query);
  if (!coreQuery) return [];
  
  const [searxDocs, searxVideos, ddgDocs, arxiv] = await Promise.all([
    fetchSearXNG(coreQuery, 'general'),
    fetchSearXNG(coreQuery, 'videos'),
    fetchDDG(coreQuery),
    fetchArxiv(coreQuery)
  ]);
  
  const combined = [...arxiv, ...searxDocs, ...ddgDocs, ...searxVideos];
  const seen = new Set();
  return combined.filter(r => {
    if (seen.has(r.link)) return false;
    seen.add(r.link);
    return true;
  });
}

export async function researchTopic(query, sendEvent) {
  sendEvent('log', { agent: 'Researcher', message: `Learning how to: ${query}` });
  const sources = await aggregateSearch(`how to ${query}`);
  const knowledge = sources.map(s => `- ${s.title}: ${s.snippet}`).join('\n');
  return { knowledge, sources, summary: `Learned from ${sources.length} resources.` };
}

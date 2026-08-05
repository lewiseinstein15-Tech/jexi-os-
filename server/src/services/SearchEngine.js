import fetch from 'node-fetch';
import * as cheerio from 'cheerio';

const BAD_DOMAINS = ['scribd.com', 'pinterest.com', 'facebook.com', 'instagram.com', 'tiktok.com', 'quora.com'];

function extractCoreQuery(query) {
  let q = query.toLowerCase();
  q = q.replace(/[^a-z0-9\s]/g, ' ');
  const stopWords = new Set([
    'research', 'the', 'how', 'to', 'explain', 'step', 'by', 'look', 'for', 'computer', 'science', 
    'video', 'lectures', 'github', 'repositories', 'notes', 'tutorial', 'do', 'on', 'this', 'unit', 
    'in', 'is', 'name', 'go', 'learn', 'everything', 'about', 'create', 'detailed', 'and', 'it', 
    'works', 'what', 'why', 'please', 'give', 'me', 'can', 'you', 'i', 'need', 'used', 'modern',
    'with', 'code', 'implementations', 'its', 'a', 'an', 'of', 'mechanism', 'visit', 'following', 'url', 'https', 'www'
  ]);
  const words = q.split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w));
  return words.slice(0, 6).join(' ');
}

// 1. SearXNG (Aggregates Google, Bing, Yahoo, etc. - Highly reliable)
async function fetchSearXNG(query, category = 'general') {
  const instances = ['https://search.sapti.me', 'https://searx.be', 'https://search.bus-hit.me'];
  for (const instance of instances) {
    try {
      const url = `${instance}/search?q=${encodeURIComponent(query)}&format=json&categories=${category}`;
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(5000) });
      if (!res.ok) continue;
      const data = await res.json();
      if (data?.results?.length > 0) {
        const results = data.results.slice(0, 5).map(r => {
          const isBad = BAD_DOMAINS.some(d => r.url.includes(d));
          if (isBad) return null;
          return { title: r.title, link: r.url, snippet: r.content, source: category === 'videos' ? 'YouTube' : 'Web' };
        }).filter(Boolean);
        console.log(`✓ SearXNG (${instance}) found ${results.length} ${category} results`);
        return results;
      }
    } catch (e) { /* Try next instance */ }
  }
  console.log(`✗ SearXNG failed for ${category}`);
  return [];
}

// 2. DuckDuckGo HTML Scraper (Fallback for docs)
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
      const isBad = BAD_DOMAINS.some(d => link.includes(d));
      const snippet = $(el).find(".result__snippet").text().trim();
      if (title && link && snippet && !isBad) results.push({ title, link, snippet, source: 'DuckDuckGo' });
    });
    console.log(`✓ DDG found ${results.length} results`);
    return results;
  } catch (e) { console.error("✗ DDG Error:", e.message); return []; }
}

// 3. GitHub API (Guaranteed)
async function fetchGitHub(query) {
  try {
    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=3`;
    const res = await fetch(url, { headers: { 'Accept': 'application/vnd.github.v3+json' }});
    const data = await res.json();
    console.log(`✓ GitHub found ${data?.items?.length || 0} repos`);
    return (data?.items || []).map(item => ({
      title: `GitHub: ${item.full_name}`,
      link: item.html_url,
      snippet: item.description || `Repository with ${item.stargazers_count} stars.`,
      source: 'GitHub'
    }));
  } catch (e) { console.error("✗ GitHub Error:", e.message); return []; }
}

// 4. Hacker News API (Guaranteed)
async function fetchHackerNews(query) {
  try {
    const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=3`;
    const data = await (await fetch(url)).json();
    console.log(`✓ Hacker News found ${data?.hits?.length || 0} stories`);
    return (data?.hits || []).map(hit => ({
      title: hit.title,
      link: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
      snippet: `Hacker News discussion with ${hit.points} points.`,
      source: 'Hacker News'
    }));
  } catch (e) { console.error("✗ HN Error:", e.message); return []; }
}

// 5. Wikipedia API (Guaranteed)
async function fetchWikipedia(query) {
  try {
    const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=3`;
    const data = await (await fetch(url)).json();
    console.log(`✓ Wikipedia found ${data?.query?.search?.length || 0} articles`);
    return (data?.query?.search || []).map(item => ({
      title: item.title,
      link: `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, "_"))}`,
      snippet: item.snippet.replace(/<[^>]+>/g, "") + "...",
      source: 'Wikipedia'
    }));
  } catch (e) { console.error("✗ Wiki Error:", e.message); return []; }
}

export async function aggregateSearch(query) {
  const coreQuery = extractCoreQuery(query);
  if (!coreQuery) return [];
  console.log(`🔍 Core Query Extracted: "${coreQuery}"`);

  // Run all APIs concurrently. SearXNG handles YouTube and Docs.
  const [searxDocs, searxVideos, ddgDocs, github, hn, wiki] = await Promise.all([
    fetchSearXNG(coreQuery, 'general'),
    fetchSearXNG(coreQuery, 'videos'),
    fetchDDG(coreQuery),
    fetchGitHub(coreQuery),
    fetchHackerNews(coreQuery),
    fetchWikipedia(coreQuery)
  ]);

  const combined = [...wiki, ...searxDocs, ...ddgDocs, ...searxVideos, ...hn, ...github];
  const seen = new Set();
  const final = combined.filter(r => {
    if (seen.has(r.link)) return false;
    seen.add(r.link);
    return true;
  });
  console.log(`--- SEARCH COMPLETE: ${final.length} total sources ---\n`);
  return final;
}

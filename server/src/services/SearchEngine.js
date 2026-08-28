/**
 * B164 — SEARCH ENGINE, REBUILT ON THE DSH WEB SEAM.
 * The old pipeline (scattered fetch functions, Wikipedia-heavy in practice
 * because datacenter IPs got the HTML engines blocked) is REPLACED: every
 * search now goes through WebSearch.js (the ctx.web port) — the DSH trio
 * (deepseek-official / exa / perplexity) when keys exist, plus the keyless
 * whole-web engines (DuckDuckGo ×2, Mojeek, Bing, SearXNG, Wikipedia,
 * arXiv) with health-aware cooldowns, URL-canonical dedup and cross-engine
 * rank fusion.
 *
 * Exported API kept identical for the 8 importers:
 *   isAcademicQuery(query) · aggregateSearch(query, engine?) →
 *   [{ title, link, snippet, source }] · researchTopic(query, sendEvent)
 */

import {
  activeSearchProviders, providerSearch, webSearchHealth, canonicalUrl,
} from './WebSearch.js';

// Trusted-source ranking (kept — it works).
const TRUSTED_DOMAINS = ['wikipedia.org', '.edu', '.gov', '.org', 'arxiv.org', 'github.com', 'mdn.', 'developer.', 'stackoverflow.com', 'geeksforgeeks.org', 'khanacademy.org', 'britannica.com', 'coursera.org', 'mit.edu', 'stanford.edu', 'openstax.org', 'docs.', 'nature.com', 'sciencedirect.com', 'reuters.com', 'bbc.com', 'nasa.gov', 'who.int'];

const ACADEMIC_MARKERS = /\b(paper|arxiv|study|survey|thesis|journal|algorithm|theory|methodology|scientific|experiment|dataset|preprint|research paper)\b/i;
export function isAcademicQuery(query) {
  return ACADEMIC_MARKERS.test(String(query || ''));
}

function trustedScore(url) {
  let score = 0;
  try {
    const host = new URL(url).hostname;
    if (TRUSTED_DOMAINS.some((d) => host.includes(d))) score += 3;
    if (url.startsWith('https://')) score += 1;
  } catch { /* unparseable */ }
  return score;
}

function extractCoreQuery(query) {
  if (query.includes(':')) return query;
  let q = query.toLowerCase();
  q = q.replace(/[^a-z0-9\s]/g, ' ');
  const stopWords = new Set(['research', 'the', 'how', 'to', 'explain', 'step', 'by', 'look', 'for', 'do', 'on', 'this', 'in', 'is', 'name', 'go', 'learn', 'everything', 'about', 'and', 'it', 'works', 'what', 'why', 'please', 'give', 'me', 'can', 'you', 'i', 'need', 'with', 'its', 'a', 'an', 'of', 'visit', 'following', 'url', 'build', 'make', 'app', 'website', 'system']);
  const words = q.split(/\s+/).filter((w) => w.length > 2 && !stopWords.has(w));
  return words.slice(0, 8).join(' ');
}

/**
 * Fan one query across EVERY active provider in parallel (dsh web seam),
 * then fuse: reciprocal-rank-style agreement (a page found by N engines
 * ranks above a page found by one) + trusted-domain boost. Returns the
 * legacy shape so every importer keeps working.
 */
export async function aggregateSearch(query, specificEngine = null, opts = {}) {
  const coreQuery = extractCoreQuery(query) || String(query || '');
  if (!coreQuery.trim()) return [];

  const wantAcademic = isAcademicQuery(coreQuery);
  // `__providers` is the hermetic-test injection point (no real network).
  const actives = opts.__providers || activeSearchProviders({ includeAcademic: wantAcademic });
  const chosen = specificEngine
    ? actives.filter((p) => p.id === specificEngine || p.name.toLowerCase() === String(specificEngine).toLowerCase())
    : actives;

  const settled = await Promise.allSettled(chosen.map((p) => providerSearch(p.id, { query: coreQuery, maxResults: 8 })));

  // Fuse: rank position (engine's own order) + cross-engine agreement.
  const fused = new Map(); // canonical url → { entry, engines:Set, bestRank }
  chosen.forEach((p, i) => {
    const r = settled[i];
    if (r.status !== 'fulfilled' || !r.value) return;
    (r.value.sources || []).forEach((s, rank) => {
      const c = canonicalUrl(s.url);
      if (!c) return;
      const prev = fused.get(c);
      if (prev) {
        prev.engines.add(p.name);
        prev.bestRank = Math.min(prev.bestRank, rank);
        if (!prev.entry.snippet && s.snippet) prev.entry.snippet = s.snippet;
      } else {
        fused.set(c, {
          entry: { title: s.title || s.url, link: s.url, snippet: s.snippet || '', source: p.name },
          engines: new Set([p.name]),
          bestRank: rank,
        });
      }
    });
  });

  const scored = [...fused.values()].map((f) => ({
    ...f,
    score: (f.engines.size * 4) - f.bestRank + trustedScore(f.entry.link),
  }));
  scored.sort((a, b) => b.score - a.score);

  // DIVERSITY CAP: one engine may contribute at most 4 of the 10 (a blocked
  // web must never degrade back into a single-source firehose).
  const perEngine = new Map();
  const diversified = [];
  for (const f of scored) {
    const lead = [...f.engines][0];
    const n = perEngine.get(lead) || 0;
    if (n >= 4) continue;
    perEngine.set(lead, n + 1);
    diversified.push(f);
    if (diversified.length === 10) break;
  }

  // Legacy shape — max 10, engines listed on multi-engine finds.
  return diversified.map((f) => ({
    ...f.entry,
    ...(f.engines.size > 1 ? { engines: [...f.engines] } : {}),
  }));
}

/** Health snapshot for the settings surface (replaces the old static list). */
export function searchEngineStatus() {
  return { providers: webSearchHealth() };
}

/** Learning fast-path (kept): stream one line, search, summarize snippets. */
export async function researchTopic(query, sendEvent) {
  const engines = activeSearchProviders({});
  sendEvent?.('log', { agent: 'Researcher', message: `🔍 Scanning the whole internet — ${engines.length} engines in parallel…` });
  const sources = await aggregateSearch(`how to ${query}`);
  const knowledge = sources.map((s) => `- ${s.title}: ${s.snippet}`).join('\n');
  sendEvent?.('log', { agent: 'Researcher', message: `✓ ${sources.length} sources from ${new Set(sources.map((s) => s.source)).size} engines.` });
  return { knowledge, sources, summary: `Learned from ${sources.length} resources.` };
}

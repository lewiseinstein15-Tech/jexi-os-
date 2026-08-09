import { aggregateSearch, isAcademicQuery } from './SearchEngine.js';
import { extractContent } from './Extractor.js';
import { generateContent } from './LLMClient.js';
import { saveInternetKnowledge } from './MemoryManager.js';
import { JEXI_SYSTEM_PROMPT } from './JexiPrompt.js';

/**
 * SEARCH AGENT — the specialist research team (native port of the patterns from
 * Perplexica, gpt-researcher, Stanford STORM, Khoj, MindSearch):
 *
 *   Query Analyzer → Searcher → Re-ranker → Extractor → Synthesizer → (Gap-filler)
 *
 * Each stage consumes ONLY the previous stage's output (strict handoff), and the
 * final answer is grounded with inline citations [1]..[N] that are post-validated.
 */

// ---------------------------------------------------------------------------
// Stage 0 — small in-memory SERP cache (saves search-engine cost on repeat asks)
// ---------------------------------------------------------------------------
const serpCache = new Map();
const SERP_TTL_MS = 10 * 60 * 1000;

function cacheKey(query) {
  return String(query || '').trim().toLowerCase();
}

async function searchOne(query) {
  const key = cacheKey(query);
  const hit = serpCache.get(key);
  if (hit && Date.now() - hit.t < SERP_TTL_MS) return { query, results: hit.v, cached: true };
  const results = await aggregateSearch(query);
  serpCache.set(key, { t: Date.now(), v: results });
  if (serpCache.size > 250) {
    const oldest = serpCache.keys().next().value;
    serpCache.delete(oldest);
  }
  return { query, results, cached: false };
}

// ---------------------------------------------------------------------------
// Stage 1 — QUERY ANALYZER: decompose complex questions into sub-queries
// ---------------------------------------------------------------------------
const COMPLEX_MARKERS =
  /\b(compare|comparison|vs\.?|versus|difference|differences|pros and cons|relationship|impact of|history of|overview of|how do|explain both|and also|in detail|thoroughly|everything about)\b/i;

export function isComplexQuery(query) {
  return String(query || '').length > 70 || COMPLEX_MARKERS.test(query);
}

/** Return 1–3 independent sub-queries that together cover the question. */
export async function analyzeQuery(query) {
  if (!isComplexQuery(query)) {
    return { complex: false, subQueries: [query], reason: 'simple question — single focused search' };
  }
  try {
    const prompt =
      `Break this research question into 1 to 3 independent sub-queries that together fully cover it. ` +
      `Return ONLY a JSON array of strings — no markdown, no explanation.\nQuestion: "${query}"`;
    const raw = await generateContent(
      prompt,
      'You decompose research questions into focused search sub-queries.',
      null,
      { temperature: 0.1 }
    );
    const match = String(raw || '').match(/\[[\s\S]*\]/);
    const parsed = match ? JSON.parse(match[0]) : [];
    const subs = parsed
      .filter((q) => typeof q === 'string' && q.trim().length > 3)
      .slice(0, 3)
      .map((q) => q.trim());
    if (subs.length) {
      return { complex: true, subQueries: subs, reason: `decomposed into ${subs.length} focused sub-searches` };
    }
  } catch (e) { /* fall through to single query */ }
  return { complex: true, subQueries: [query], reason: 'decomposition unavailable — using the full question' };
}

// ---------------------------------------------------------------------------
// Stage 2 — SEARCHER: run every sub-query across all engines, in parallel
// ---------------------------------------------------------------------------
export async function parallelSearch(subQueries) {
  const settled = await Promise.allSettled((subQueries || []).map((q) => searchOne(q)));
  const pools = settled.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  const seen = new Set();
  const merged = [];
  for (const pool of pools) {
    for (const r of pool.results || []) {
      // Normalize URL: strip anchors, trailing slash, UTM junk — then dedupe
      const norm = String(r.link || '')
        .replace(/#.*$/, '')
        .replace(/\/$/, '')
        .replace(/[?&]utm_[^&]*/g, '')
        .toLowerCase();
      if (!norm || seen.has(norm)) continue;
      seen.add(norm);
      merged.push({ ...r, subQuery: pool.query });
    }
  }
  return { pools, merged };
}

// ---------------------------------------------------------------------------
// Stage 3 — RE-RANKER: score sources by relevance to the actual question
// ---------------------------------------------------------------------------
export function rankSources(query, results) {
  const terms = String(query || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3);
  // Proper nouns (capitalized words) are strong signals — a page titled "Paris"
  // must beat "French people" when the question asks about Paris.
  const entities = [
    ...new Set(
      String(query || '')
        .replace(/[^a-zA-Z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 2 && /^[A-Z]/.test(w))
    ),
  ];
  const scored = (results || []).map((r) => {
    const blob = `${r.title || ''} ${r.snippet || ''}`.toLowerCase();
    let relevance = 0;
    for (const t of terms) if (blob.includes(t)) relevance += 1;
    for (const e of entities) if (blob.includes(e.toLowerCase())) relevance += 3;
    return { ...r, relevance };
  });
  scored.sort((a, b) => b.relevance - a.relevance || 0);
  return scored.slice(0, 6);
}

// ---------------------------------------------------------------------------
// Stage 4 — EXTRACTOR: deep-read the top sources in parallel
// ---------------------------------------------------------------------------
/** Hard per-source timeout so one slow/hanging page can't freeze the team. */
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`source timed out (${label})`)), ms)),
  ]);
}

const SOURCE_READ_TIMEOUT_MS = 25000;

export async function deepRead(sources, query, sendEvent) {
  const settled = await Promise.allSettled(
    (sources || []).map((src) =>
      withTimeout((async () => {
        const content = await extractContent(src.link);
        let hostname = '';
        try { hostname = new URL(src.link).hostname; } catch (e) {}
        return {
          title: content.title || src.title,
          link: src.link,
          source_name: hostname,
          snippet: src.snippet || '',
          content: String(content.content || '').slice(0, 6000),
        };
      })(),
      SOURCE_READ_TIMEOUT_MS,
      src.link
    )
  )
);
  const deep = [];
  settled.forEach((res, i) => {
    const src = (sources || [])[i];
    if (res.status === 'fulfilled' && res.value && res.value.content && res.value.content.length > 80) {
      const item = { ...res.value, idx: deep.length + 1 };
      deep.push(item);
      try {
        sendEvent?.('website', {
          site: {
            title: item.title,
            url: item.link,
            favicon: `https://www.google.com/s2/favicons?domain=${item.source_name || ''}&sz=64`,
            status: 'success',
          },
        });
        sendEvent?.('log', { agent: 'Extractor', message: `✓ Read ${item.source_name || item.link}` });
      } catch (e) {}
    } else {
      try {
        sendEvent?.('log', { agent: 'Extractor', message: `✗ Could not read ${src?.link || 'source'}` });
      } catch (e) {}
    }
  });
  return deep;
}

// ---------------------------------------------------------------------------
// Stage 5 — SYNTHESIZER: grounded answer with inline citations [1]..[N]
// ---------------------------------------------------------------------------
/** No-LLM fallback: still answers, from real sources, when the provider fails. */
function fallbackSummary(query, deep) {
  const lines = (deep || [])
    .map((s, i) => `${i + 1}. **${s.title}** — ${s.link}\n   ${String(s.content || '').replace(/\s+/g, ' ').slice(0, 280)}`)
    .join('\n\n');
  return (
    `### 🔎 JEXI OS — RESEARCH RESULTS\n\n` +
    `The AI synthesis was unavailable (no API key or provider error), so here is what my sources say about "${query}":\n\n${lines}\n\n` +
    `### Sources\n${(deep || []).map((s, i) => `${i + 1}. [${s.title}](${s.link})`).join('\n')}`
  );
}

export async function synthesizeGrounded(query, deep) {
  const sourceText = (deep || [])
    .map((s, i) => `SOURCE [${i + 1}]: ${s.title}\nLink: ${s.link}\n${s.content}`)
    .join('\n\n---\n\n');

  const prompt =
    `The user asked: "${query}"\n\n` +
    `I retrieved these numbered sources from the web:\n\n${sourceText}\n\n` +
    `Write the final answer. RULES:\n` +
    `1. Answer ONLY from the sources above. Never invent facts that are not in them.\n` +
    `2. After every factual claim, add an inline citation marker like [1] or [2] matching the source it came from.\n` +
    `3. If the sources do not contain the answer, say exactly: "I could not find enough information in my retrieved sources to answer this."\n` +
    `4. Use ## headings, bold key facts, and numbered points.\n` +
    `5. End with a "### Sources" section listing ONLY the sources you cited, as markdown links.`;

  let summary;
  try {
    summary = await generateContent(prompt, JEXI_SYSTEM_PROMPT, null, { temperature: 0.3 });
  } catch (e) {
    summary = fallbackSummary(query, deep);
  }

  // Post-validation: drop any citation marker that points at a source we don't have
  const valid = new Set((deep || []).map((_, i) => String(i + 1)));
  const cleaned = String(summary || '').replace(/\[(\d+)\]/g, (m, n) => (valid.has(n) ? m : ''));
  return cleaned;
}

// ---------------------------------------------------------------------------
// Gap-filler — one extra in-depth pass when coverage looks thin (bounded loop)
// ---------------------------------------------------------------------------
async function needsMore(deep, summary) {
  if (!deep || deep.length < 2) return true;
  const body = String(summary || '');
  if (body.length < 250) return true;
  if (body.includes('could not find enough information')) return true;
  return false;
}

// ---------------------------------------------------------------------------
// THE TEAM — main entry: run all stages and return a grounded, cited answer
// ---------------------------------------------------------------------------
export async function runSearchTeam(query, sendEvent) {
  // 1. Query Analyzer
  sendEvent?.('log', { agent: 'Query Analyzer', message: `🔎 Analyzing the best way to search: "${query}"` });
  const plan = await analyzeQuery(query);
  sendEvent?.('log', {
    agent: 'Query Analyzer',
    message: plan.complex
      ? `↗ ${plan.reason}: ${plan.subQueries.join('  |  ')}`
      : `→ ${plan.reason}.`,
  });

  // 2. Searcher (parallel across engines + sub-queries, with cache)
  const { merged } = await parallelSearch(plan.subQueries);
  sendEvent?.('log', { agent: 'Searcher', message: `🔍 Found ${merged.length} candidate sources across engines.` });
  if (merged.length === 0) return { summary: '', sources: [] };

  // 3. Re-ranker (relevance to the actual question, not just domain trust)
  const ranked = rankSources(query, merged);
  sendEvent?.('log', { agent: 'Re-ranker', message: `🎯 Re-ranked — keeping the ${ranked.length} most relevant.` });

  // 4. Extractor (parallel deep-read)
  sendEvent?.('log', { agent: 'Extractor', message: `📖 Deep-reading ${ranked.length} sources in parallel...` });
  const deep = await deepRead(ranked, query, sendEvent);
  sendEvent?.('log', { agent: 'Extractor', message: `✅ Extracted full text from ${deep.length} sources.` });

  if (deep.length === 0) return { summary: '', sources: [] };

  // Quality gate: for a NON-academic question, only academic papers/PDFs means
  // the general engines failed (flaky/blocked) — let the orchestrator fall back
  // to the browser instead of answering from irrelevant papers.
  const junkOnly =
    !isAcademicQuery(query) &&
    deep.length > 0 &&
    deep.every((s) => /arxiv\.org|\.pdf/i.test(s.link || ''));
  if (junkOnly) {
    sendEvent?.('log', { agent: 'Re-ranker', message: '⚠ Only academic papers matched — not relevant to this question. Falling back to the browser...' });
    return { summary: '', sources: [] };
  }

  // 5. Synthesizer (grounded, cited)
  sendEvent?.('log', { agent: 'Synthesizer', message: '🧠 Synthesizing a cited answer from the sources...' });
  let summary = await synthesizeGrounded(query, deep);

  // 5.5 Gap-filler — one bounded extra pass if the answer is thin
  if (await needsMore(deep, summary)) {
    sendEvent?.('log', { agent: 'Searcher', message: '↻ Coverage is thin — one more in-depth pass...' });
    try {
      const extra = await searchOne(`${query} in-depth overview`);
      const extraRanked = rankSources(query, extra.results).slice(0, 2);
      const extraDeep = await deepRead(extraRanked, query, sendEvent);
      const combined = [...deep, ...extraDeep].slice(0, 6);
      if (combined.length > deep.length) {
        summary = await synthesizeGrounded(query, combined);
        sendEvent?.('log', { agent: 'Synthesizer', message: `↻ Re-synthesized with ${combined.length} sources.` });
      }
    } catch (e) { /* keep the first answer */ }
  }

  // Remember it for next time (fast path on repeat questions)
  try {
    saveInternetKnowledge(String(query).slice(0, 200), summary, deep.map((s) => s.link).filter(Boolean));
  } catch (e) {}

  return {
    summary,
    sources: deep.map((s) => ({ title: s.title, link: s.link, source_name: s.source_name })),
    confidence: deep.length >= 3 ? 92 : 85,
  };
}

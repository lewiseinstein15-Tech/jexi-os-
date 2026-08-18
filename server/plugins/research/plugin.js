/**
 * JEXI OS — Research Plugin (B125, DeepSeek Harness `packages/web/tool-web`
 * mirror).
 *
 * Replaces the old "research team pipeline" with DSH's model-driven
 * research: the model calls `web_search` (returns sources) then `web_fetch`
 * (returns full page text) itself, iterating until it can synthesize a
 * cited answer. No Query-Analyzer→Searcher→Re-ranker→Extractor pipeline —
 * the model IS the researcher (exactly like DSH's agent loop).
 *
 * Tool contracts mirror dsh tool-web exactly:
 *   web_search(query) → { content?, sources: [{url,title,snippet,publishedAt}], truncated }
 *   web_fetch(url)    → { url, statusCode, body: {kind:'html'|'text', content}, truncated }
 *
 * Also contributes the `research` skill (progressive SKILL.md + reference.md)
 * with DSH's search→fetch→synthesize guidance, and registers it so discovery
 * shows it (custom rank 300).
 */

import { aggregateSearch } from '../../src/services/SearchEngine.js';
import { extractContent } from '../../src/services/Extractor.js';

export const name = 'research';
export const version = '1.0.0';
export const inject = ['tools', 'skills', 'events'];

const SEARCH_TIMEOUT_MS = 45000;
const FETCH_TIMEOUT_MS = 60000;
const MAX_SEARCH_RESULTS = 10;
const MAX_SNIPPET_CHARS = 320;
const MAX_BODY_CHARS = 12000;

const RESEARCH_SKILL_BODY = `# Research Skill

You are the researcher. Drive the research YOURSELF with web_search and web_fetch — there is no pipeline behind you.

## Phases
1. **PLAN**: break the question into 2-4 sub-queries (different phrasings, different angles). Search each.
2. **SELECT**: from the returned sources pick 3-6 that look authoritative (prefer primary sources, official docs, reputable press; note dates).
3. **READ**: web_fetch each selected URL. Extract claims, evidence, numbers, and limitations.
4. **COMPARE**: note where sources AGREE, DISAGREE, and why (methodology, date, bias).
5. **SYNTHESIZE**: write the answer with:
   - ## Consensus — what most sources agree on
   - ## Points of Disagreement — the real debates
   - ## Bottom Line — the direct answer to the question
   Cite EVERY claim inline as a markdown link to a source you actually fetched: [title](url).
   Never cite a URL you did not retrieve.

## Rules
- Use web_fetch for full content — snippets alone are not enough for depth.
- Prefer the most recent sources for time-sensitive facts; say when the information may be stale.
- If the sources contradict, say so — do not smooth over disagreement.
- Never invent quotes, statistics, or URLs. If a source failed to load, say "could not verify".
- End with ## Sources listing every URL you used.`;

const RESEARCH_SKILL_REFERENCE = `## Templates and rubrics

### Answer template
## Consensus
- …

## Points of Disagreement
- …

## Bottom Line
Direct answer with inline citations [title](url).

## Sources
- [title](url)
- …

### Source-quality rubric
1. Primary (official docs, papers, raw data) — best.
2. Institutional (universities, standards bodies, WHO/UN).
3. Reputable press (Reuters/AP/BBC/Nature…).
4. Blogs/forums/AI-generated — use only to find primary sources.

### Red flags
- No date / clearly outdated for a time-sensitive claim.
- Paywalled snippet that claims more than the visible text.
- Aggregator pages that rewrite one original source.
- Conflicting numbers without an explanation.`;

/** DSH web_search tool. */
async function registerWebSearch(ctx, unregisters) {
  const unregister = ctx.tools.register({
    slug: 'web_search',
    name: 'Web Search',
    desc: 'Search the web for current information. Returns an optional summary answer and a list of source URLs.',
    args: { query: { type: 'string', required: true, desc: 'The search query.' } },
    timeoutMs: SEARCH_TIMEOUT_MS,
    handler: async (args) => {
      const query = String((args && args.query) || '').trim();
      if (!query) return { ok: false, error: 'query required' };
      const articles = await aggregateSearch(query, null);
      const sources = (articles || []).slice(0, MAX_SEARCH_RESULTS).map((a) => ({
        url: String(a.link || a.url || '').slice(0, 500),
        title: String(a.title || '').slice(0, 300),
        ...(a.snippet ? { snippet: String(a.snippet).slice(0, MAX_SNIPPET_CHARS) } : {}),
        ...(a.published ? { publishedAt: String(a.published) } : {}),
      })).filter((s) => s.url);
      return { ok: true, kind: 'web-search-result', sources, truncated: sources.length >= MAX_SEARCH_RESULTS };
    },
  });
  unregisters.push(unregister);
}

/** DSH web_fetch tool. */
async function registerWebFetch(ctx, unregisters) {
  const unregister = ctx.tools.register({
    slug: 'web_fetch',
    name: 'Web Fetch',
    desc: 'Fetch the content of a specific HTTP(S) URL and return it decoded to text.',
    args: { url: { type: 'string', required: true, desc: 'The HTTP(S) URL to fetch.' } },
    timeoutMs: FETCH_TIMEOUT_MS,
    handler: async (args) => {
      const url = String((args && args.url) || '').trim();
      if (!url) return { ok: false, error: 'url required' };
      if (!/^https?:\/\//i.test(url)) return { ok: false, error: 'only http(s) URLs are supported' };
      const res = await extractContent(url);
      const content = String((res && (res.content || res.text)) || '').slice(0, MAX_BODY_CHARS);
      if (!content) return { ok: false, error: `no readable content at ${url.slice(0, 120)}` };
      return {
        ok: true,
        kind: 'web-fetch-result',
        url: String(res.url || url),
        statusCode: 200,
        body: { kind: 'text', content },
        truncated: String((res && (res.content || res.text)) || '').length > MAX_BODY_CHARS,
      };
    },
  });
  unregisters.push(unregister);
}

/** Apply is called at boot with the plugin context. Return a cleanup fn. */
export async function apply(ctx) {
  const unregisters = [];
  await registerWebSearch(ctx, unregisters);
  await registerWebFetch(ctx, unregisters);

  // Register the research skill so discovery lists it (custom rank 300) and
  // the model can load it with skill-load.
  const unregSkill = ctx.skills.register({
    slug: 'research',
    name: 'Research',
    desc: 'Model-driven web research: search, fetch, synthesize a cited answer.',
    load: () => RESEARCH_SKILL_BODY,
    body: RESEARCH_SKILL_BODY,
  });
  unregisters.push(unregSkill);

  return () => { for (const u of unregisters) { try { u(); } catch { /* noop */ } } };
}

export { RESEARCH_SKILL_BODY, RESEARCH_SKILL_REFERENCE };

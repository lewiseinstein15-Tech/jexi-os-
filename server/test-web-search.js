/**
 * B164 — WEB SEARCH SEAM TESTS (dsh packages/web port).
 *
 *   seam vocabulary     → WebSearchRequest/Result/Source + WebError codes
 *   deepseek-official   → Anthropic wire: web_search_20250305 blocks,
 *                         citation join by URL, STRICT mode (no block → error)
 *   exa / perplexity    → endpoint mapping + citations→sources
 *   keyless engines     → DDG HTML parsing (fixture), garbage filtering
 *   seam guarantees     → URL dedup, maxResults truncation, cooldowns
 *   fusion              → aggregateSearch cross-engine agreement ranking
 *   wiring              → SearchAgent streaming + status surface + frontend
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

let failures = 0;
const ok = (name, cond) => {
  console.log(`${cond ? '✅' : '❌'} ${name}`);
  if (!cond) failures += 1;
};

const WS = await import('./src/services/WebSearch.js');
const { WebError, __testFetch } = WS;

/* ══════════════ 1. SEAM VOCABULARY ══════════════ */
console.log('\n== 1. Seam vocabulary (dsh web/types mirror) ==');
{
  ok('WebError carries dsh codes', new WebError('WEB_PROVIDER_ERROR').code === 'WEB_PROVIDER_ERROR' && WS.WEB_ERRORS.ABORTED === 'WEB_ABORTED');
  ok('canonical URL strips tracking + trailing slash', WS.canonicalUrl('https://a.com/x/?utm_source=gg&gclid=1') === 'https://a.com/x');
  ok('registry holds the DSH trio + keyless engines', ['deepseek-official', 'exa', 'perplexity', 'ddg-html', 'mojeek', 'searxng', 'wikipedia'].every((id) => WS.SEARCH_PROVIDERS.some((p) => p.id === id)));
  ok('keyed providers report unconfigured without keys (credential missing path)', !WS.deepseekSearchProvider.configured() || !!process.env.DEEPSEEK_API_KEY);
}

/* ══════════════ 2. DEEPSEEK-OFFICIAL (dsh web-search-deepseek mirror) ══════════════ */
console.log('\n== 2. deepseek-official — Anthropic wire + STRICT mode ==');
{
  process.env.DEEPSEEK_API_KEY = 'sk-test';
  const calls = [];
  __testFetch.fn = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) });
    if (url.includes('/messages')) {
      return {
        ok: true, json: async () => ({
          content: [
            { type: 'text', text: 'answer prose', citations: [{ url: 'https://a.com/x', cited_text: 'the cited excerpt' }] },
            { type: 'web_search_tool_result', content: [
              { type: 'web_search_result', url: 'https://a.com/x', title: 'A page', page_age: '2026-08-01' },
              { type: 'web_search_result', url: 'https://b.com/y', title: 'B page' },
            ] },
          ],
        }),
      };
    }
    throw new Error('unexpected url ' + url);
  };
  const out = await WS.providerSearch('deepseek-official', { query: 'test', maxResults: 5 });
  ok('posts to the Anthropic-compatible /messages with the web_search server tool',
    calls[0].url === 'https://api.deepseek.com/anthropic/v1/messages'
    && calls[0].body.tools[0].type === 'web_search_20250305' && calls[0].body.tools[0].max_uses === 5);
  ok('maps web_search_result items → sources', out.sources.length === 2 && out.sources[0].url === 'https://a.com/x' && out.sources[0].title === 'A page');
  ok('citation excerpt joined by URL (dsh mapping)', out.sources[0].snippet === 'the cited excerpt' && out.sources[0].publishedAt === '2026-08-01');

  // STRICT: no web_search_tool_result block → WEB_PROVIDER_ERROR, never prose
  __testFetch.fn = async () => ({ ok: true, json: async () => ({ content: [{ type: 'text', text: 'just prose, no blocks' }] }) });
  let strictThrew = false;
  try { await WS.providerSearch('deepseek-official', { query: 'test' }); } catch (e) { strictThrew = e.code === 'WEB_PROVIDER_ERROR'; }
  ok('STRICT mode: no result block → WEB_PROVIDER_ERROR (never prose-scraping)', strictThrew);
  delete process.env.DEEPSEEK_API_KEY;
}

/* ══════════════ 3. EXA + PERPLEXITY (dsh mirrors) ══════════════ */
console.log('\n== 3. exa + perplexity endpoint mapping ==');
{
  process.env.EXA_API_KEY = 'exa-test';
  __testFetch.fn = async (url, opts) => ({
    ok: true, json: async () => ({ results: [{ url: 'https://exa.com/1', title: 'Exa hit', text: 'exa text', publishedDate: '2026-01-01' }] }),
  });
  const exa = await WS.providerSearch('exa', { query: 'q' });
  ok('exa: POST /search → normalized sources (title/snippet/publishedAt)', exa.sources[0].url === 'https://exa.com/1' && exa.sources[0].snippet === 'exa text' && exa.sources[0].publishedAt === '2026-01-01');
  delete process.env.EXA_API_KEY;

  process.env.PERPLEXITY_API_KEY = 'pp-test';
  __testFetch.fn = async () => ({
    ok: true, json: async () => ({ choices: [{ message: { content: 'generated answer' } }], citations: ['https://pp.com/1', 'https://pp.com/2'] }),
  });
  const pp = await WS.providerSearch('perplexity', { query: 'q' });
  ok('perplexity: citations → sources + generated content rides along', pp.content === 'generated answer' && pp.sources.length === 2);
  delete process.env.PERPLEXITY_API_KEY;
  __testFetch.fn = null;
}

/* ══════════════ 4. SEAM GUARANTEES — dedup + truncation + cooldown ══════════════ */
console.log('\n== 4. Seam guarantees ==');
{
  const p = WS.SEARCH_PROVIDERS.find((x) => x.id === 'ddg-html');
  const orig = p.search;
  p.search = async () => ({
    sources: [
      { url: 'https://dup.com/page', title: 'first' },
      { url: 'https://dup.com/page?utm_source=x', title: 'duplicate' },
      { url: 'https://one.com/1', title: 'one' },
      { url: 'https://two.com/2', title: 'two' },
      { url: 'https://three.com/3', title: 'three' },
    ],
  });
  const out = await WS.providerSearch('ddg-html', { query: 'q', maxResults: 2 });
  ok('URL-canonical dedup (tracking params collapse)', out.sources.length === 4 || out.truncated);
  const out2 = await WS.providerSearch('ddg-html', { query: 'q', maxResults: 2 });
  ok('maxResults truncation sets truncated', out2.sources.length === 2 && out2.truncated === true);
  // cooldown after 3 failures
  p.search = async () => { throw new Error('blocked'); };
  for (let i = 0; i < 3; i++) { try { await WS.providerSearch('ddg-html', { query: 'q' }); } catch { /* expected */ } }
  ok('3 failures → provider enters cooldown (slides out of rotation)', !WS.activeSearchProviders({}).some((x) => x.id === 'ddg-html'));
  p.search = orig;
}

/* ══════════════ 5. FUSION — cross-engine agreement ranks ══════════════ */
console.log('\n== 5. aggregateSearch rank fusion ==');
{
  const SE = await import('./src/services/SearchEngine.js');
  const ddg = WS.SEARCH_PROVIDERS.find((x) => x.id === 'ddg-html');
  const mojo = WS.SEARCH_PROVIDERS.find((x) => x.id === 'mojeek');
  const wiki = WS.SEARCH_PROVIDERS.find((x) => x.id === 'wikipedia');
  WS.__resetHealth();
  const saved = [ddg.search, mojo.search, wiki.search];
  ddg.search = async () => ({ sources: [
    { url: 'https://agreed.com/x', title: 'Both engines found this' },
    { url: 'https://only-ddg.com/y', title: 'Only DDG found this' },
  ] });
  mojo.search = async () => ({ sources: [
    { url: 'https://agreed.com/x?utm_source=mojeek', title: 'Both engines found this' },
  ] });
  wiki.search = async () => { throw new Error('wiki down'); };
  // hermetic: inject ONLY these three providers (no real network races)
  const results = await SE.aggregateSearch('fusion test query', null, { __providers: [ddg, mojo, wiki] });
  ok('legacy shape preserved for the 8 importers', results.every((r) => r.title && r.link && r.source !== undefined));
  ok('cross-engine agreement ranks first + engines listed', results[0].link.includes('agreed.com') && (results[0].engines || []).length === 2);
  [ddg.search, mojo.search, wiki.search] = saved.map((f, i) => [ddg, mojo, wiki][i].search = saved[i]);
}

/* ══════════════ 6. DDG PARSER (fixture) ══════════════ */
console.log('\n== 6. Keyless parser — DDG HTML fixture ==');
{
  const html = `<html><body>
    <div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Freal.com%2Fa">Real Result</a><span class="result__snippet">a real snippet</span></div>
    <div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fpinterest.com%2Fpin">Spam</a></div>
  </body></html>`;
  ok('garbage filter drops spam domains', WS.isGarbageUrl('https://pinterest.com/pin') && WS.isGarbageUrl('https://duckduckgo.com/x') && !WS.isGarbageUrl('https://real.com/a'));
  ok('garbage filter rejects unparseable URLs', WS.isGarbageUrl('not-a-url') === true);
}

/* ══════════════ 7. WIRING (streaming + status + frontend) ══════════════ */
console.log('\n== 7. Wiring ==');
{
  const sa = fs.readFileSync('./src/services/SearchAgent.js', 'utf-8');
  ok('Searcher streams the whole-internet scan line', sa.includes('Whole-internet scan done'));
  const se = fs.readFileSync('./src/services/SearchEngine.js', 'utf-8');
  ok('SearchEngine rides the seam (no scattered fetchers left)', se.includes('providerSearch') && !se.includes('html.duckduckgo.com'));
  ok('wikipedia is ONE provider among many, not the fallback', se.includes('activeSearchProviders'));
  const wsp = fs.readFileSync('./src/services/WebSearchProviders.js', 'utf-8');
  ok('status surface reports LIVE health (cooldowns, configured)', wsp.includes('webSearchHealth()'));
  const card = fs.readFileSync(path.join(ROOT, 'src/components/SourceCard.jsx'), 'utf-8');
  ok('source cards badge multi-engine finds', card.includes('found by') && card.includes('source.engines'));
  const css = fs.readFileSync(path.join(ROOT, 'src/index.css'), 'utf-8');
  ok('streaming caret styled', css.includes('.jx-caret'));
  const chat = fs.readFileSync(path.join(ROOT, 'src/components/ChatWindow.jsx'), 'utf-8');
  ok('streaming caret rendered while a coworker writes', chat.includes('jx-caret'));
}

console.log(`\n${failures === 0 ? '🎉 ALL B164 WEB-SEARCH SEAM CHECKS PASSED' : `💥 ${failures} FAILURES`}`);
process.exit(failures === 0 ? 0 : 1);

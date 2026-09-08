// KEYLESS PREMIUM MESH + REDIS REST — hermetic tests (no network).
// Parser fixtures are trimmed from REAL live probes (2026-09-08).
import {
  mcpFirstText, parseExaSearchText, parseAnysearchResults, parseParallelResults,
  ccDomainFromQuery, __parseSearxInstances, SEARCH_PROVIDERS, callsToday,
  __noteCall, __resetBudgets, WebError,
} from './src/services/WebSearch.js';
import { isRestRedisUrl, redisRestToken, resolveRedisMode, createRestAdapter } from './src/services/MemoryManager.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass++; console.log(`  ✅ ${msg}`); }
  else { fail++; console.error(`  ❌ ${msg}`); }
};
const throwsWeb = (fn) => { try { fn(); return false; } catch (e) { return e instanceof WebError; } };

// --- MCP envelope: pure JSON (Parallel/AnySearch) ---
const jsonEnv = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'hello mesh' }] } });
ok(mcpFirstText(jsonEnv) === 'hello mesh', 'mcpFirstText reads pure-JSON envelopes');
// --- MCP envelope: SSE event-stream (Exa) ---
const sseEnv = 'event: message\ndata: {"result":{"content":[{"type":"text","text":"exa says hi"}]}}\n';
ok(mcpFirstText(sseEnv) === 'exa says hi', 'mcpFirstText reads SSE envelopes');
ok(throwsWeb(() => mcpFirstText('{"jsonrpc":"2.0","id":1,"error":{"code":-32602,"message":"nope"}}}')), 'mcpFirstText throws WebError on JSON-RPC errors');
ok(throwsWeb(() => mcpFirstText('not json at all')), 'mcpFirstText throws WebError on garbage');
ok(throwsWeb(() => mcpFirstText(JSON.stringify({ result: { content: [{ type: 'text', text: 'Error executing tool web_search: bad args' }] } }))), 'mcpFirstText surfaces tool-level errors');

// --- Exa result text (real shape) ---
const exaText = 'Title: Safaricom Free Airtime\nURL: https://www.tuko.co.ke/tech/638731-test/\nPublished: 2026-09-05T08:01:52.000Z\nAuthor: Jane Doe\nHighlights:\n# Safaricom Free Airtime\n\n- Safaricom announced free airtime for all Kenyan customers today in Nairobi.\n';
const exa = parseExaSearchText(exaText);
ok(exa.length === 1 && exa[0].url === 'https://www.tuko.co.ke/tech/638731-test/', 'parseExaSearchText extracts URL');
ok(exa[0].title === 'Safaricom Free Airtime' && exa[0].publishedAt === '2026-09-05T08:01:52.000Z', 'parseExaSearchText extracts title + date');
ok((exa[0].snippet || '').includes('Safaricom announced'), 'parseExaSearchText extracts highlight snippet');
ok(parseExaSearchText('Title: No URL Here\nPublished: 2026-01-01').length === 0, 'parseExaSearchText drops blocks without URL');

// --- AnySearch markdown (real shape) ---
const anyText = '## Search Results (2 results, 100ms)\n\n### 1. First Title\n- **URL**: https://example.com/1\n- First snippet text here for testing.\n\n### 2. Second Title\n- **URL**: https://example.com/2\n- Second snippet text here for testing.';
const any = parseAnysearchResults(anyText);
ok(any.length === 2 && any[0].url === 'https://example.com/1', 'parseAnysearchResults extracts both URLs');
ok(any[0].title === 'First Title' && any[1].title === 'Second Title', 'parseAnysearchResults extracts titles');
ok((any[0].snippet || '').includes('First snippet'), 'parseAnysearchResults extracts snippets');

// --- Parallel JSON-in-text (real shape) ---
const parText = JSON.stringify({ search_id: 's1', results: [{ url: 'https://example.com/p', title: 'P Title', publish_date: '2026-09-01', excerpts: ['First excerpt', 'second excerpt'] }] });
const par = parseParallelResults(parText);
ok(par.length === 1 && par[0].url === 'https://example.com/p', 'parseParallelResults extracts URL');
ok(par[0].snippet === 'First excerpt second excerpt' && par[0].publishedAt === '2026-09-01', 'parseParallelResults joins excerpts + date');
ok(throwsWeb(() => parseParallelResults('not json')), 'parseParallelResults rejects garbage');

// --- Common Crawl domain gate ---
ok(ccDomainFromQuery('safaricom.co.ke latest news') === 'safaricom.co.ke', 'ccDomainFromQuery finds domains');
ok(ccDomainFromQuery('what is artificial intelligence') === '', 'ccDomainFromQuery empty for keywords');

// --- searx.space discovery parse ---
const space = { instances: {
  'https://good.example/': { http: { status_code: 200 }, main: true, timing: { search: {} } },
  'https://slow.example/': { http: { status_code: 200 }, main: true, timing: { search: { error: 'timeout' } } },
  'https://down.example/': { http: { status_code: 500 }, main: true },
} };
const found = __parseSearxInstances(space);
ok(found.length === 1 && found[0] === 'https://good.example', 'searx discovery keeps healthy mains only');

// --- registry: mesh legs present + ordered before the HTML floor ---
const ids = SEARCH_PROVIDERS.map((p) => p.id);
for (const id of ['exa-anon', 'parallel', 'anysearch', 'commoncrawl', 'firecrawl']) {
  ok(ids.includes(id), `registry includes ${id}`);
}
ok(ids.indexOf('exa-anon') < ids.indexOf('ddg-html'), 'mesh outranks the HTML floor');
ok(ids.indexOf('firecrawl') < ids.indexOf('exa-anon'), 'keyed APIs outrank keyless mesh');
ok(SEARCH_PROVIDERS.find((p) => p.id === 'firecrawl').envKey === 'FIRECRAWL_API_KEY', 'firecrawl is keyed');

// --- daily budget brake ---
__resetBudgets();
ok(callsToday('exa-anon') === 0, 'budget starts at zero');
__noteCall('exa-anon'); __noteCall('exa-anon');
ok(callsToday('exa-anon') === 2, 'budget counts calls');
__resetBudgets();
ok(callsToday('exa-anon') === 0, 'budget resets');

// --- Redis REST mode resolution ---
const keepUrl = process.env.REDIS_URL, keepTok = process.env.UPSTASH_REDIS_REST_TOKEN, keepTok2 = process.env.REDIS_TOKEN;
try {
  ok(isRestRedisUrl('https://x.upstash.io') && !isRestRedisUrl('rediss://x:6379'), 'REST scheme detection');
  process.env.REDIS_URL = 'rediss://default:pw@host:6379';
  ok(resolveRedisMode() === 'tcp', 'rediss:// resolves to tcp mode');
  process.env.REDIS_URL = 'https://actual-llama-132733.upstash.io';
  ok(resolveRedisMode() === 'rest', 'https:// resolves to rest mode');
  delete process.env.REDIS_URL;
  ok(resolveRedisMode() === 'none', 'unset resolves to none');
  process.env.UPSTASH_REDIS_REST_TOKEN = 'tok-A';
  ok(redisRestToken() === 'tok-A', 'REST token prefers UPSTASH_REDIS_REST_TOKEN');
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  process.env.REDIS_TOKEN = 'tok-B';
  ok(redisRestToken() === 'tok-B', 'REST token falls back to REDIS_TOKEN');
} finally {
  if (keepUrl === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = keepUrl;
  if (keepTok === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN; else process.env.UPSTASH_REDIS_REST_TOKEN = keepTok;
  if (keepTok2 === undefined) delete process.env.REDIS_TOKEN; else process.env.REDIS_TOKEN = keepTok2;
}

// --- REST adapter maps the ioredis surface (stubbed client, no network) ---
const seen = {};
const stub = {
  get: async (k) => { seen.get = k; return k === 'missing' ? null : 'v:' + k; },
  set: async (k, v, o) => { seen.set = [k, v, o]; return 'OK'; },
  del: async (...ks) => { seen.del = ks; return ks.length; },
  keys: async (pat) => { seen.keys = pat; return ['a']; },
};
const ad = createRestAdapter(stub);
const getHit = await ad.get('k1');
ok(getHit === 'v:k1', 'adapter get passes through');
ok((await ad.get('missing')) === null, 'adapter get maps missing to null');
await ad.set('mk', '{"a":1}', 'EX', 99);
ok(seen.set[0] === 'mk' && seen.set[2] && seen.set[2].ex === 99, "adapter set maps 'EX' seconds to { ex }");
await ad.set('mk2', 'plain');
ok(seen.set[0] === 'mk2' && seen.set[2] === undefined, 'adapter set without TTL passes no options');
await ad.del('a', 'b');
ok(JSON.stringify(seen.del) === '["a","b"]', 'adapter del passes keys through');
ok(JSON.stringify(await ad.keys('jexi:*')) === '["a"]', 'adapter keys passes pattern through');
ok((await ad.ping()) === 'PONG', 'adapter ping answers PONG');
await ad.connect(); ad.disconnect();
ok(true, 'adapter connect/disconnect are safe no-ops');

console.log(`\nWEB-MESH: ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);

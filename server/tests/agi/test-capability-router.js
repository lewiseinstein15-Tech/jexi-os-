/**
 * ULTIMATE ARCHITECTURE UPGRADE — Capability Router contracts (§7, §11).
 * Deterministic, keyless. The live weather round-trip mirrors the gateway
 * test convention: a real lazy connect proves the dispatch seam end-to-end.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DATA_DIR = './data/test-agi-capability-router';

const cr = await import('../../src/services/CapabilityRouter.js');
const { routeCapabilities, selectMcpToolset, resolveMcpFunction, mcpToolFunctionName, sanitizeJsonSchema, CAPABILITY_SERVERS, INTENT_CAPABILITIES } = cr;

/* ═══ 1. intent → capabilities → servers routing ═══════════════════════════ */

test('research intent routes to the research capability servers', () => {
  const r = routeCapabilities('research this topic', { intent: 'research' });
  assert.ok(r.capabilities.includes('web_search'));
  assert.ok(r.servers.includes('free-search'));
  assert.ok(r.servers.includes('arxiv'));
  assert.ok(!r.servers.includes('weather'));
});

test('weather intent routes ONLY to the weather server (minimum set)', () => {
  const r = routeCapabilities('weather in Nairobi', { intent: 'weather' });
  assert.deepEqual(r.servers, ['weather']);
});

test('keyword boosts add their capabilities to the generic intent set', () => {
  const r = routeCapabilities('solve x^2-4 with a paper about algebra', { intent: 'research' });
  // the user's words (math + papers) join the intent defaults
  assert.ok(r.capabilities.includes('math'));
  assert.ok(r.capabilities.includes('papers'));
  assert.ok(r.servers.includes('sympy'));
  assert.ok(r.servers.includes('arxiv'));
  // with no keywords the intent defaults alone apply
  const plain = routeCapabilities('research this topic', { intent: 'research' });
  assert.ok(!plain.capabilities.includes('math'));
});

test('lightweight intents route to zero MCP servers', () => {
  for (const intent of ['direct_answer', 'conversation', 'memory_query']) {
    const r = routeCapabilities('hello', { intent });
    assert.equal(r.servers.length, 0, `${intent} must stay lightweight`);
    assert.equal(r.capabilities.length, 0);
  }
});

/* ═══ 2. toolset selection ═════════════════════════════════════════════════ */

test('a weather question offers ONLY weather tools, named mcp__server__tool', () => {
  const sel = selectMcpToolset('What is the weather in Kericho, Kenya?', { intent: 'direct_answer' });
  assert.ok(sel.schemas.length > 0 && sel.schemas.length <= 5);
  assert.deepEqual(sel.servers, ['weather']);
  for (const s of sel.schemas) {
    assert.ok(s.function.name.startsWith('mcp__weather__'), s.function.name);
    assert.equal(s.type, 'function');
    assert.ok(s.function.parameters.type === 'object');
  }
  const first = sel.schemas[0].function.name;
  assert.equal(sel.map[first].server, 'weather');
});

test('a papers question still gets arxiv even with web_search present (no starvation)', () => {
  const sel = selectMcpToolset('Find me recent papers on quantum computing', { intent: 'research' });
  assert.ok(sel.servers.includes('arxiv'), 'arxiv must survive the limit');
  assert.ok(sel.servers.length >= 4);
  assert.ok(sel.schemas.length <= 16);
});

test('every capability maps to at least one server that exists in the directory', async () => {
  const { loadToolDirectory } = await import('../../src/services/MCPGateway.js');
  const dir = loadToolDirectory();
  for (const [cap, servers] of Object.entries(CAPABILITY_SERVERS)) {
    if (cap === 'browser') continue; // browser trio is host-dependent by design
    for (const s of servers) {
      assert.ok(dir[s], `capability "${cap}" points at unknown server "${s}"`);
    }
  }
});

test('browser servers are never routed into chat (host-dependent trio)', () => {
  delete process.env.JEXI_MCP_BROWSER;
  const trio = ['playwright', 'playwright-ea', 'chrome-devtools'];
  for (const intent of Object.keys(INTENT_CAPABILITIES)) {
    const r = routeCapabilities('open example.com and click around', { intent });
    assert.ok(!r.servers.some((s) => trio.includes(s)), `${intent} must not route browser servers`);
  }
  const sel = selectMcpToolset('open example.com and click', { intent: 'code_task' });
  assert.ok(!sel.servers.some((s) => trio.includes(s)));
});

test('function names resolve back to the real server+tool', () => {
  const fname = mcpToolFunctionName('weather', 'get_forecast(date: str)');
  assert.equal(fname, 'mcp__weather__get_forecast_date__str_'); // unsafe chars sanitized to _
  assert.equal(resolveMcpFunction(fname), null); // not a real directory tool
  const real = resolveMcpFunction('mcp__weather__get_forecast');
  assert.ok(real && real.server === 'weather' && real.tool === 'get_forecast');
});

/* ═══ 3. schema sanitization ═══════════════════════════════════════════════ */

test('sanitizeJsonSchema keeps only function-calling-safe keys', () => {
  const out = sanitizeJsonSchema({
    type: 'object',
    $defs: { x: {} },
    oneOf: [{ type: 'string' }],
    properties: {
      city: { type: 'string', description: 'City name', minLength: 1, pattern: 'x' },
      days: { type: 'number', enum: [1, 2, 3] },
      nested: { type: 'object', properties: { deep: { type: 'string' } }, required: ['deep'] },
    },
    required: ['city'],
    additionalProperties: false,
  });
  assert.equal(out.type, 'object');
  assert.ok(!('$defs' in out) && !('oneOf' in out) && !('additionalProperties' in out));
  assert.equal(out.properties.city.type, 'string');
  assert.ok(!('minLength' in out.properties.city));
  assert.deepEqual(out.properties.days.enum, [1, 2, 3]);
  assert.equal(out.properties.nested.properties.deep.type, 'string');
  assert.deepEqual(out.required, ['city']);
});

test('sanitizeJsonSchema degrades junk to string and caps depth', () => {
  assert.deepEqual(sanitizeJsonSchema(null), { type: 'string' });
  assert.deepEqual(sanitizeJsonSchema('weird'), { type: 'string' });
  let deep = { type: 'string' };
  for (let i = 0; i < 8; i++) deep = { type: 'object', properties: { a: deep } };
  const out = sanitizeJsonSchema(deep);
  assert.ok(out); // never throws
});

/* ═══ 4. ToolRuntime dispatch seam (live lazy connect) ═════════════════════ */

test('executeTool dispatches mcp__ names through the gateway (live weather round-trip)', { timeout: 120_000 }, async () => {
  const { executeTool } = await import('../../src/services/ToolRuntime.js');
  const r = await executeTool({ slug: 'mcp__weather__get_weather_summary', args: { city_name: 'Nairobi' } });
  assert.ok(r.ok, `weather round-trip failed: ${r.error}`);
  assert.equal(r.server, 'weather');
  assert.equal(r.mcpTool, 'get_weather_summary');
  assert.ok(r.durationMs > 0);
  const text = JSON.stringify(r.result || {});
  assert.ok(/temp|weather|wind|condition/i.test(text), 'real weather content expected');
});

test('executeTool refuses MCP names on lightweight intents (B52 spirit)', async () => {
  const { executeTool } = await import('../../src/services/ToolRuntime.js');
  const r = await executeTool({ slug: 'mcp__weather__get_weather_summary', args: { city_name: 'Nairobi' }, intent: 'direct_answer' });
  assert.equal(r.ok, false);
  assert.equal(r.blocked, true);
  assert.ok(r.error.includes('allowlist'));
});

test('executeTool reports unknown mcp__ names honestly', async () => {
  const { executeTool } = await import('../../src/services/ToolRuntime.js');
  const r = await executeTool({ slug: 'mcp__nosuchserver__no_such_tool' });
  assert.equal(r.ok, false);
  assert.ok(/Unknown MCP tool/.test(r.error));
});

/* ═══ 5. capability metadata coherence ═════════════════════════════════════ */

test('every intent capability exists in CAPABILITY_SERVERS or is intentionally native-only', () => {
  for (const [intent, caps] of Object.entries(INTENT_CAPABILITIES)) {
    for (const c of caps) {
      assert.ok(CAPABILITY_SERVERS[c], `intent "${intent}" uses unknown capability "${c}"`);
    }
  }
});

/* ═══ cleanup: the live weather test leaves a stdio connection open — close
   its transport so node --test can exit (a lingering child would hang the
   whole `npm test` chain after the results print). ════════════════════════ */
test('cleanup: gateway connections closed', async () => {
  const { disconnectGatewayServer } = await import('../../src/services/MCPGateway.js');
  await disconnectGatewayServer('weather');
});

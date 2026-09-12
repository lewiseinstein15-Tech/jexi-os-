/**
 * JEXI OS — Unified provider layer tests (fully offline, no network).
 *
 * Covers: catalog integrity, one-secret config resolution/validation/
 * masking, OpenAI-compatible adapter (REST + SSE + retries + timeouts +
 * tools fallback), Anthropic native adapter (+ translators), capability
 * profiles, and the `unified` router leg.
 *
 * Run: node test-unified-providers.js
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

import { PROVIDERS, getProviderDef, publicCatalog } from './src/services/providers/catalog.js';
import {
  resolveModelConfig, validateModelConfig, mergeUnifiedConfig, maskConfig, maskKey, UNIFIED_ENVS,
} from './src/services/providers/modelConfig.js';
import {
  chatCompletions, listModels, classifyError, parseRetryAfterMs, isToolsRejection, parseToolCalls, readSseStream,
} from './src/services/providers/openaiCompat.js';
import {
  toAnthropicRequest, fromAnthropicResponse, readAnthropicStream, anthropicMessages,
} from './src/services/providers/anthropicNative.js';
import { capabilitiesFor, noteProbe, clearProbes, inputTokenBudget, estimateTokens } from './src/services/providers/capabilities.js';
import { tryUnified, unifiedToolConfig, probeConfig, configForCall } from './src/services/providers/unified.js';
import { isUnifiedConfigured } from './src/services/providers/modelConfig.js';
import { providerOrder, configuredProviders } from './src/providers/runtime/ProviderRouter.js';

let passed = 0;
const ok = (name, fn) => {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      return r.then(() => { passed += 1; console.log(`  ✓ ${name}`); });
    }
    passed += 1;
    console.log(`  ✓ ${name}`);
    return Promise.resolve();
  } catch (e) {
    console.error(`  ✗ ${name}\n    ${e.stack.split('\n').slice(0, 3).join('\n    ')}`);
    process.exitCode = 1;
    return Promise.resolve();
  }
};

/* ---------------- mock fetch plumbing ---------------- */

function mockHeaders(map = {}) {
  const lower = {};
  for (const [k, v] of Object.entries(map)) lower[String(k).toLowerCase()] = v;
  return { get: (k) => lower[String(k).toLowerCase()] ?? null };
}

function mockJsonResponse(obj, { status = 200, headers = {} } = {}) {
  const text = JSON.stringify(obj);
  return {
    ok: status >= 200 && status < 300, status, headers: mockHeaders(headers),
    text: async () => text, json: async () => JSON.parse(text),
  };
}

function mockTextResponse(text, { status = 200, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300, status, headers: mockHeaders(headers),
    text: async () => text, json: async () => JSON.parse(text),
  };
}

function mockStreamResponse(chunks, { status = 200 } = {}) {
  const enc = new TextEncoder();
  const queue = chunks.map((c) => enc.encode(c));
  return {
    ok: status >= 200 && status < 300, status, headers: mockHeaders({}),
    text: async () => '', json: async () => ({}),
    body: {
      getReader: () => ({
        read: async () => (queue.length ? { done: false, value: queue.shift() } : { done: true, value: undefined }),
      }),
    },
  };
}

const ENV_KEYS = Object.values(UNIFIED_ENVS);
function scrubUnifiedEnv() {
  const saved = {};
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  return () => { for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } };
}

const SETTINGS_PATH = path.join(process.cwd(), 'settings.json');
function stashSettings() {
  const had = fs.existsSync(SETTINGS_PATH);
  const backup = had ? fs.readFileSync(SETTINGS_PATH, 'utf-8') : null;
  if (had) fs.unlinkSync(SETTINGS_PATH);
  return () => {
    if (backup !== null) fs.writeFileSync(SETTINGS_PATH, backup, 'utf-8');
    else if (fs.existsSync(SETTINGS_PATH)) fs.unlinkSync(SETTINGS_PATH);
  };
}

const realFetch = globalThis.fetch;

/* ---------------- tests ---------------- */
console.log('unified providers:');

await ok('catalog: 17 providers, unique ids, complete fields', () => {
  assert.strictEqual(PROVIDERS.length, 17);
  const ids = PROVIDERS.map((p) => p.id);
  assert.strictEqual(new Set(ids).size, ids.length);
  for (const p of PROVIDERS) {
    assert.ok(p.label, `${p.id} label`);
    assert.ok(['openai', 'anthropic'].includes(p.adapter), `${p.id} adapter`);
    assert.strictEqual(typeof p.needsKey, 'boolean', `${p.id} needsKey`);
    assert.ok(Array.isArray(p.modelHints), `${p.id} modelHints`);
  }
  assert.ok(getProviderDef('GROQ').id === 'groq', 'case-insensitive lookup');
  assert.strictEqual(getProviderDef('nope'), null);
});

await ok('catalog: public view contains no key material', () => {
  const pub = publicCatalog();
  const s = JSON.stringify(pub);
  assert.ok(!/sk-|gsk_|ghp_|Bearer/i.test(s));
  assert.ok(pub.every((p) => !('apiKey' in p)));
});

await ok('config: env resolution + incomplete env yields null', () => {
  const restore = scrubUnifiedEnv();
  try {
    assert.strictEqual(resolveModelConfig({ settings: null }), null);
    process.env.JEXI_MODEL_PROVIDER = 'groq';
    process.env.JEXI_MODEL_API_KEY = 'gsk-test-1234';
    process.env.JEXI_MODEL_NAME = 'openai/gpt-oss-120b';
    const cfg = resolveModelConfig({ settings: null });
    assert.ok(cfg);
    assert.strictEqual(cfg.provider, 'groq');
    assert.strictEqual(cfg.baseUrl, 'https://api.groq.com/openai/v1');
    assert.strictEqual(cfg.source, 'env');
    delete process.env.JEXI_MODEL_API_KEY; // key-required → unusable
    assert.strictEqual(resolveModelConfig({ settings: null }), null);
  } finally { restore(); }
});

await ok('config: local provider needs no key; custom needs baseUrl', () => {
  const restore = scrubUnifiedEnv();
  try {
    process.env.JEXI_MODEL_PROVIDER = 'ollama';
    process.env.JEXI_MODEL_NAME = 'qwen3';
    const oll = resolveModelConfig({ settings: null });
    assert.ok(oll && oll.baseUrl === 'http://127.0.0.1:11434/v1');
    process.env.JEXI_MODEL_PROVIDER = 'custom';
    process.env.JEXI_MODEL_NAME = 'm';
    assert.strictEqual(resolveModelConfig({ settings: null }), null); // no URL
    process.env.JEXI_MODEL_BASE_URL = 'https://x.example.com/v1/';
    const custom = resolveModelConfig({ settings: null });
    assert.ok(custom && custom.baseUrl === 'https://x.example.com/v1', 'trailing slash trimmed');
  } finally { restore(); }
});

await ok('config: precedence opts > settings > env; unknown id skipped', () => {
  const restore = scrubUnifiedEnv();
  try {
    process.env.JEXI_MODEL_PROVIDER = 'groq';
    process.env.JEXI_MODEL_API_KEY = 'gsk-env';
    process.env.JEXI_MODEL_NAME = 'env-model';
    const settings = { unified: { provider: 'deepseek', apiKey: 'ds-set', model: 'deepseek-chat' } };
    assert.strictEqual(resolveModelConfig({ settings }).source, 'settings');
    const viaOpts = resolveModelConfig({ settings, opts: { unified: { provider: 'openai', apiKey: 'sk-o', model: 'gpt-4o-mini' } } });
    assert.strictEqual(viaOpts.source, 'opts');
    assert.strictEqual(viaOpts.provider, 'openai');
    // unknown settings provider → falls through to env honestly
    const fell = resolveModelConfig({ settings: { unified: { provider: 'wat', apiKey: 'x', model: 'y', baseUrl: 'https://h.test/v1' } } });
    assert.ok(fell && fell.source === 'env' && fell.provider === 'groq');
  } finally { restore(); }
});

await ok('config: validate + merge (sticky key) + mask', () => {
  const v = validateModelConfig({ provider: 'Groq', apiKey: 'gsk-abc', model: 'm' });
  assert.ok(v.ok && v.normalized.provider === 'groq');
  assert.ok(!validateModelConfig({ provider: 'groq', model: 'm' }).ok, 'missing key rejected');
  assert.ok(!validateModelConfig({ provider: 'custom', model: 'm' }).ok, 'missing baseUrl rejected');
  assert.ok(!validateModelConfig({ provider: 'nope', model: 'm', baseUrl: 'https://x/v1' }).ok, 'unknown provider rejected');
  assert.ok(!validateModelConfig({ provider: 'openai', apiKey: 'k', model: 'm', baseUrl: 'ftp://x' }).ok, 'bad URL rejected');
  const merged = mergeUnifiedConfig({ provider: 'groq', apiKey: 'STORED', model: 'a' }, { model: 'b' });
  assert.strictEqual(merged.apiKey, 'STORED');
  assert.strictEqual(merged.model, 'b');
  assert.strictEqual(mergeUnifiedConfig({ apiKey: 'STORED' }, { clearKey: true }).apiKey, '');
  const masked = maskConfig({ provider: 'groq', apiKey: 'gsk-SECRETKEY', model: 'm', baseUrl: 'u', source: 'env' });
  assert.ok(masked.configured && masked.keyLast4 === '…TKEY');
  assert.ok(!JSON.stringify(masked).includes('SECRET'));
  assert.strictEqual(maskKey(''), '');
  assert.deepStrictEqual(maskConfig(null), { configured: false });
});

await ok('openai: REST success shapes request correctly', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return mockJsonResponse({ model: 'm', choices: [{ message: { content: 'hello', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'run', arguments: '{"a":1}' } }] } }], usage: { total_tokens: 9 } });
  };
  const out = await chatCompletions({
    baseUrl: 'https://x.test/v1/', apiKey: 'K', model: 'm',
    messages: [{ role: 'user', content: 'hi' }], tools: [{ type: 'function', function: { name: 'run', parameters: {} } }],
    fetchImpl, extraHeaders: { 'X-T': '1' }, providerLabel: 't',
  });
  assert.strictEqual(out.text, 'hello');
  assert.deepStrictEqual(out.toolCalls, [{ id: 'c1', name: 'run', arguments: { a: 1 } }]);
  assert.strictEqual(out.usage.total_tokens, 9);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].url, 'https://x.test/v1/chat/completions');
  assert.strictEqual(calls[0].init.headers.Authorization, 'Bearer K');
  assert.strictEqual(calls[0].init.headers['X-T'], '1');
  const body = JSON.parse(calls[0].init.body);
  assert.strictEqual(body.model, 'm');
  assert.strictEqual(body.tool_choice, 'auto');
  assert.strictEqual(body.stream, false);
});

await ok('openai: malformed tool args never throw', () => {
  const parsed = parseToolCalls({ tool_calls: [{ id: 'x', function: { name: 'f', arguments: '{bad,}' } }] });
  assert.strictEqual(parsed.length, 1);
  assert.ok(parsed[0].arguments && typeof parsed[0].arguments === 'object');
});

await ok('openai: SSE stream accumulates text + tools + reasoning', async () => {
  const sse = [
    'data: {"choices":[{"delta":{"reasoning_content":"thinking"}}]}\n',
    'data: {"choices":[{"delta":{"content":"Hel"}}]}\n',
    'data: {"choices":[{"delta":{"content":"lo","tool_calls":[{"index":0,"id":"c9","function":{"name":"run","arguments":"{\\"a\\":"}}]}}]}\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"1}"}}]}}]}\n',
    'data: [DONE]\n',
  ];
  const deltas = [];
  const fetchImpl = async () => mockStreamResponse(sse);
  const out = await chatCompletions({
    baseUrl: 'https://x/v1', model: 'm', messages: [{ role: 'user', content: 'hi' }],
    stream: true, fetchImpl, onToken: (t) => deltas.push(t),
  });
  assert.strictEqual(out.text, 'Hello');
  assert.strictEqual(out.think, 'thinking');
  assert.deepStrictEqual(deltas, ['Hel', 'lo']);
  assert.deepStrictEqual(out.toolCalls, [{ id: 'c9', name: 'run', arguments: { a: 1 } }]);
});

await ok('openai: 429 retries with Retry-After, then succeeds', async () => {
  let n = 0;
  const fetchImpl = async () => {
    n += 1;
    if (n === 1) return mockTextResponse('slow down', { status: 429, headers: { 'retry-after': '0' } });
    return mockJsonResponse({ choices: [{ message: { content: 'recovered' } }] });
  };
  const out = await chatCompletions({ baseUrl: 'https://x/v1', model: 'm', messages: [{ role: 'user', content: 'h' }], fetchImpl, retries: 2 });
  assert.strictEqual(out.text, 'recovered');
  assert.strictEqual(n, 2);
});

await ok('openai: 401 never retried; codes classify honestly', async () => {
  let n = 0;
  const fetchImpl = async () => { n += 1; return mockTextResponse('bad key', { status: 401 }); };
  const err = await chatCompletions({ baseUrl: 'https://x/v1', model: 'm', messages: [{ role: 'user', content: 'h' }], fetchImpl }).then(() => null, (e) => e);
  assert.ok(err && err.code === 'AUTH' && err.retryable === false);
  assert.strictEqual(n, 1);
  assert.strictEqual(classifyError({ status: 402, bodyText: '' }).code, 'PAYMENT');
  assert.strictEqual(classifyError({ status: 404, bodyText: 'model xyz' }).code, 'MODEL_NOT_FOUND');
  assert.strictEqual(classifyError({ status: 503, bodyText: '' }).retryable, true);
  assert.strictEqual(classifyError({ networkError: new Error('fetch failed') }).code, 'NETWORK');
  assert.strictEqual(parseRetryAfterMs(mockHeaders({ 'retry-after': '2' })), 2000);
  assert.strictEqual(parseRetryAfterMs(mockHeaders({}), 'Please retry in 46.8s'), 46800);
  assert.ok(isToolsRejection(400, 'Unrecognized request argument: tools'));
  assert.ok(!isToolsRejection(400, 'max tokens exceeded'));
});

await ok('openai: tools rejection falls back to plain text once', async () => {
  const bodies = [];
  const fetchImpl = async (url, init) => {
    bodies.push(JSON.parse(init.body));
    if (bodies.length === 1) return mockTextResponse('tools not supported', { status: 400 });
    return mockJsonResponse({ choices: [{ message: { content: 'plain answer' } }] });
  };
  const out = await chatCompletions({
    baseUrl: 'https://x/v1', model: 'm', messages: [{ role: 'user', content: 'h' }],
    tools: [{ type: 'function', function: { name: 'f', parameters: {} } }], fetchImpl,
  });
  assert.strictEqual(out.text, 'plain answer');
  assert.strictEqual(out.toolsFallback, true);
  assert.strictEqual(bodies.length, 2);
  assert.ok(!('tools' in bodies[1]), 'second attempt drops tools');
});

await ok('openai: timeout aborts and is retryable', async () => {
  let n = 0;
  // Hangs like a dead provider, but honors abort like a real fetch client.
  const fetchImpl = (url, init) => {
    n += 1;
    return new Promise((_, rej) => {
      const sig = init && init.signal;
      if (sig) {
        if (sig.aborted) rej(new Error('This operation was aborted'));
        else sig.addEventListener('abort', () => rej(new Error('This operation was aborted')), { once: true });
      }
    });
  };
  const err = await chatCompletions({ baseUrl: 'https://x/v1', model: 'm', messages: [{ role: 'user', content: 'h' }], fetchImpl, timeoutMs: 30, retries: 1 }).then(() => null, (e) => e);
  assert.ok(err && (err.code === 'TIMEOUT' || /abort|timeout/i.test(err.message)));
  assert.strictEqual(n, 2, 'one retry after timeout');
});

await ok('openai: listModels returns ids; 404 yields null', async () => {
  const ids = await listModels({ baseUrl: 'https://x/v1', fetchImpl: async () => mockJsonResponse({ data: [{ id: 'a' }, { id: 'b' }] }) });
  assert.deepStrictEqual(ids, ['a', 'b']);
  const none = await listModels({ baseUrl: 'https://x/v1', fetchImpl: async () => mockTextResponse('no', { status: 404 }) });
  assert.strictEqual(none, null);
});

await ok('readSseStream: usable standalone', async () => {
  const res = mockStreamResponse(['data: {"choices":[{"delta":{"content":"A"}}]}\n', 'data: [DONE]\n']);
  const out = await readSseStream(res, {});
  assert.strictEqual(out.text, 'A');
});

await ok('anthropic: request translator (system/tools/roles)', () => {
  const req = toAnthropicRequest([
    { role: 'system', content: 'SYS' },
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: null, tool_calls: [{ id: 't1', function: { name: 'run', arguments: '{"x":1}' } }] },
    { role: 'tool', tool_call_id: 't1', content: 'out' },
  ], [{ type: 'function', function: { name: 'run', description: 'd', parameters: { type: 'object', properties: { x: { type: 'number' } } } } }]);
  assert.strictEqual(req.system, 'SYS');
  assert.strictEqual(req.messages.length, 3);
  assert.strictEqual(req.messages[1].content[0].type, 'tool_use');
  assert.strictEqual(req.messages[2].role, 'user');
  assert.strictEqual(req.messages[2].content[0].type, 'tool_result');
  assert.strictEqual(req.tools[0].input_schema.properties.x.type, 'number');
});

await ok('anthropic: response translator → OpenAI-shaped tools', () => {
  const out = fromAnthropicResponse({
    content: [
      { type: 'thinking', thinking: 'hmm' },
      { type: 'text', text: 'done' },
      { type: 'tool_use', id: 'tu1', name: 'run', input: { x: 2 } },
    ],
    stop_reason: 'tool_use',
  });
  assert.strictEqual(out.text, 'done');
  assert.strictEqual(out.think, 'hmm');
  assert.deepStrictEqual(out.toolCalls, [{ id: 'tu1', name: 'run', arguments: { x: 2 } }]);
  assert.strictEqual(out.rawToolCalls[0].type, 'function');
});

await ok('anthropic: messages() shapes native request + classifies errors', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return mockJsonResponse({ model: 'c', content: [{ type: 'text', text: 'OK' }], stop_reason: 'end_turn' });
  };
  const out = await anthropicMessages({ apiKey: 'AK', model: 'c', messages: [{ role: 'user', content: 'hi' }], system: 'S', fetchImpl });
  assert.strictEqual(out.text, 'OK');
  assert.strictEqual(calls[0].url, 'https://api.anthropic.com/v1/messages');
  assert.strictEqual(calls[0].init.headers['x-api-key'], 'AK');
  assert.ok(calls[0].init.headers['anthropic-version']);
  const body = JSON.parse(calls[0].init.body);
  assert.strictEqual(body.system, 'S');
  assert.strictEqual(body.max_tokens, 4096);
  const err = await anthropicMessages({ apiKey: 'BAD', model: 'c', messages: 'hi', fetchImpl: async () => mockTextResponse('bad', { status: 401 }) }).then(() => null, (e) => e);
  assert.ok(err && err.code === 'AUTH' && err.provider === 'anthropic');
});

await ok('anthropic: stream accumulates text + tool input_json', async () => {
  const sse = [
    'event: content_block_start\ndata: {"index":0,"content_block":{"type":"text"}}\n\n',
    'event: content_block_delta\ndata: {"index":0,"delta":{"type":"text_delta","text":"Hi"}}\n\n',
    'event: content_block_start\ndata: {"index":1,"content_block":{"type":"tool_use","id":"tu2","name":"run"}}\n\n',
    'event: content_block_delta\ndata: {"index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"a\\":1}"}}\n\n',
  ];
  const seen = [];
  const out = await readAnthropicStream(mockStreamResponse(sse), { onToken: (t) => seen.push(t) });
  assert.strictEqual(out.text, 'Hi');
  assert.deepStrictEqual(seen, ['Hi']);
  assert.deepStrictEqual(out.toolCalls, [{ id: 'tu2', name: 'run', arguments: { a: 1 } }]);
});

await ok('capabilities: known models + honest defaults + probes', () => {
  clearProbes();
  assert.strictEqual(capabilitiesFor('gpt-4o-mini').contextWindow, 128000);
  assert.strictEqual(capabilitiesFor('claude-sonnet-4-5').contextWindow, 200000);
  assert.strictEqual(capabilitiesFor('gemini-2.5-flash').contextWindow, 1000000);
  assert.strictEqual(capabilitiesFor('deepseek-reasoner').reasoning, true);
  assert.strictEqual(capabilitiesFor('deepseek-reasoner').tools, false);
  const unk = capabilitiesFor('some-future-model-9000');
  assert.strictEqual(unk.source, 'default');
  assert.strictEqual(unk.contextWindow, 32000);
  noteProbe('some-future-model-9000', { vision: true });
  assert.strictEqual(capabilitiesFor('some-future-model-9000').vision, true);
  clearProbes();
  assert.ok(inputTokenBudget('gpt-4o-mini') > 100000);
  assert.strictEqual(estimateTokens('abcd'), 1);
});

await ok('unified leg: empty string when unconfigured; null tool config', async () => {
  const restoreEnv = scrubUnifiedEnv();
  const restoreSettings = stashSettings();
  try {
    assert.strictEqual(isUnifiedConfigured(), false);
    assert.strictEqual(configForCall({}), null);
    assert.strictEqual(await tryUnified('hi', 'sys', null, {}, []), '');
    assert.strictEqual(unifiedToolConfig({}), null);
  } finally { restoreEnv(); restoreSettings(); }
});

await ok('unified leg: openai-shaped provider end-to-end (mocked fetch)', async () => {
  const restoreEnv = scrubUnifiedEnv();
  const restoreSettings = stashSettings();
  globalThis.fetch = async () => mockJsonResponse({ choices: [{ message: { content: 'unified says hi' } }] });
  try {
    process.env.JEXI_MODEL_PROVIDER = 'groq';
    process.env.JEXI_MODEL_API_KEY = 'gsk-x';
    process.env.JEXI_MODEL_NAME = 'm1';
    assert.strictEqual(isUnifiedConfigured(), true);
    const text = await tryUnified('hello', 'be nice', null, {}, []);
    assert.strictEqual(text, 'unified says hi');
    const cfg = unifiedToolConfig({});
    assert.ok(cfg && cfg.baseUrl === 'https://api.groq.com/openai/v1' && cfg.models[0] === 'm1');
  } finally { globalThis.fetch = realFetch; restoreEnv(); restoreSettings(); }
});
await ok('unified leg: anthropic marker + streaming meta', async () => {
  const restoreEnv = scrubUnifiedEnv();
  const restoreSettings = stashSettings();
  const seen = [];
  // tryUnified streams when onToken is set -> mock an Anthropic SSE body.
  globalThis.fetch = async () => mockStreamResponse([
    'event: content_block_start\ndata: {"index":0,"content_block":{"type":"text"}}\n\n',
    'event: content_block_delta\ndata: {"index":0,"delta":{"type":"text_delta","text":"claude hi"}}\n\n',
  ]);
  try {
    process.env.JEXI_MODEL_PROVIDER = 'anthropic';
    process.env.JEXI_MODEL_API_KEY = 'sk-ant-x';
    process.env.JEXI_MODEL_NAME = 'claude-haiku-4-5';
    const cfg = unifiedToolConfig({});
    assert.ok(cfg && cfg.unifiedNative === 'anthropic');
    const text = await tryUnified('hello', '', null, { onToken: (t, m) => seen.push([t, m]) }, []);
    assert.strictEqual(text, 'claude hi');
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0][1].provider, 'unified');
  } finally { globalThis.fetch = realFetch; restoreEnv(); restoreSettings(); }
});

await ok('probe: openai + anthropic success/failure (mocked)', async () => {
  const okFetch = async (url) => (String(url).endsWith('/models')
    ? mockJsonResponse({ data: [{ id: 'm1' }] })
    : mockJsonResponse({ choices: [{ message: { content: 'OK' } }] }));
  const p1 = await probeConfig({ provider: 'groq', apiKey: 'k', model: 'm1', baseUrl: 'https://g/v1' }, { fetchImpl: okFetch });
  assert.ok(p1.ok && p1.modelListed === true && p1.latencyMs >= 0);
  const badFetch = async () => mockTextResponse('nope', { status: 401 });
  const p2 = await probeConfig({ provider: 'groq', apiKey: 'bad', model: 'm1', baseUrl: 'https://g/v1' }, { fetchImpl: badFetch });
  assert.ok(!p2.ok && p2.code === 'AUTH');
  const aFetch = async () => mockJsonResponse({ content: [{ type: 'text', text: 'OK' }] });
  const p3 = await probeConfig({ provider: 'anthropic', apiKey: 'k', model: 'c', baseUrl: 'https://api.anthropic.com/v1' }, { fetchImpl: aFetch });
  assert.ok(p3.ok && p3.provider === 'anthropic');
});

await ok('router: unified leads order + configured list when settings file present', async () => {
  const restoreEnv = scrubUnifiedEnv();
  const restoreSettings = stashSettings();
  try {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify({ unified: { provider: 'deepseek', apiKey: 'ds-local-test', model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com/v1' } }), 'utf-8');
    assert.strictEqual(isUnifiedConfigured(), true, 'no-arg check reads settings file');
    assert.strictEqual(providerOrder()[0], 'unified', 'unified leads default order');
    assert.strictEqual(providerOrder('gemini')[0], 'unified', 'unified leads prefer order too');
    assert.ok(configuredProviders().includes('unified'), 'unified in configured list');
  } finally { restoreEnv(); restoreSettings(); }
});

console.log(`\nunified providers: ${passed} checks passed${process.exitCode ? ' (WITH FAILURES)' : ''}`);

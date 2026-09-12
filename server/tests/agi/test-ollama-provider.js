/**
 * ARENA REBUILD — Ollama provider contracts (spec Part 6).
 * NO real Ollama and NO local model is ever run in this test: a tiny mock
 * HTTP server imitates Ollama's OpenAI-compatible endpoint. What is proven:
 * the provider talks the right protocol, takes the right config, sits first
 * on the ladder when enabled, and fails HONESTLY (falling through to the
 * remote rungs) when the endpoint is unreachable.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.DATA_DIR = './data/test-agi-ollama';

const { generateContent } = await import('../../src/providers/runtime/LLMClient.js');
const { providerOrder, configuredProviders, providerHealthSnapshot, resetProviderHealth } = await import('../../src/providers/runtime/ProviderRouter.js');

/* ── the mock Ollama: OpenAI-compatible /v1 endpoint ─────────────────────── */

function startMockOllama(makeText = (m) => `MOCK-OLLAMA[${m}] says hi`) {
  const seen = { models: 0, chats: [] };
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/v1/models') {
      seen.models += 1;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: [{ id: 'qwen3:latest' }, { id: 'deepseek-r1:8b' }] }));
      return;
    }
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const parsed = JSON.parse(body || '{}');
        seen.chats.push(parsed);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          id: 'chatcmpl-mock',
          model: parsed.model,
          choices: [{ index: 0, message: { role: 'assistant', content: makeText(parsed.model) }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }));
      });
      return;
    }
    res.writeHead(404); res.end('{}');
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, seen })));
}

/* ═══ 1. ladder position ═══════════════════════════════════════════════════ */

test('MODEL_PROVIDER=ollama puts the local model FIRST on every ladder', () => {
  const before = providerOrder('');
  assert.ok(!before.includes('ollama'), 'ollama must not be on the ladder unless enabled');
  process.env.MODEL_PROVIDER = 'ollama';
  try {
    for (const prefer of ['', 'gemini', 'openrouter']) {
      const order = providerOrder(prefer);
      assert.equal(order[0], 'ollama', `prefer="${prefer}" ladder must start with ollama`);
      assert.ok(order.includes('groq'), 'remote rungs stay as honest fallback');
    }
    assert.ok(configuredProviders().includes('ollama'), 'ollama counts as configured when enabled');
  } finally {
    delete process.env.MODEL_PROVIDER;
  }
  assert.ok(!configuredProviders().includes('ollama'), 'off by default — zero behavior change');
});

/* ═══ 2. real protocol against the mock server (no real Ollama anywhere) ═══ */

test('generateContent talks Ollama\'s OpenAI-compatible protocol end to end', { timeout: 60_000 }, async () => {
  const { server, port, seen } = await startMockOllama();
  try {
    process.env.OLLAMA_HOST = `http://127.0.0.1:${port}`;
    process.env.MODEL_NAME = 'qwen3:latest';
    const answer = await generateContent('hello there', 'You are JEXI.', null, { provider: 'ollama' });
    assert.ok(typeof answer === 'string' && answer.includes('MOCK-OLLAMA[qwen3:latest]'), `unexpected answer: ${answer}`);
    // the request was shaped correctly
    assert.equal(seen.chats.length, 1);
    const chat = seen.chats[0];
    assert.equal(chat.model, 'qwen3:latest');
    assert.equal(chat.messages[0].role, 'system');
    assert.equal(chat.messages[0].content.includes('JEXI'), true);
    assert.equal(chat.messages[1].role, 'user');
  } finally {
    delete process.env.OLLAMA_HOST;
    delete process.env.MODEL_NAME;
    server.close();
  }
});

test('custom host + model env are respected (MODEL_NAME / OLLAMA_MODEL)', { timeout: 60_000 }, async () => {
  const { server, port, seen } = await startMockOllama();
  try {
    process.env.OLLAMA_HOST = `http://127.0.0.1:${port}`;
    process.env.MODEL_NAME = 'deepseek-r1:8b';
    const answer = await generateContent('test', 'sys', null, { provider: 'ollama' });
    assert.ok(String(answer).includes('MOCK-OLLAMA[deepseek-r1:8b]'));
    assert.equal(seen.chats.at(-1).model, 'deepseek-r1:8b');
    delete process.env.MODEL_NAME;
    process.env.OLLAMA_MODEL = 'qwen3:latest';
    const answer2 = await generateContent('test', 'sys', null, { provider: 'ollama' });
    assert.ok(String(answer2).includes('MOCK-OLLAMA[qwen3:latest]'));
  } finally {
    delete process.env.OLLAMA_HOST;
    delete process.env.MODEL_NAME;
    delete process.env.OLLAMA_MODEL;
    server.close();
  }
});

/* ═══ 3. honest failure — no hang, no fake success ═════════════════════════ */

test('unreachable Ollama fails FAST and honestly (no hang, no fake text)', { timeout: 60_000 }, async () => {
  process.env.MODEL_PROVIDER = 'ollama';
  process.env.OLLAMA_HOST = 'http://127.0.0.1:9'; // nothing listens there
  resetProviderHealth('ollama');
  const t0 = Date.now();
  // Forced provider + no remote keys: the exhausted ladder must REJECT —
  // an honest error beats fake text. It must not hang.
  await assert.rejects(
    () => generateContent('hello', 'sys', null, { provider: 'ollama' }),
    () => true,
    'a dead endpoint must never produce an answer string',
  );
  const ms = Date.now() - t0;
  assert.ok(ms < 30_000, `must fail fast, took ${ms}ms`);
  // the failed ollama attempt was recorded — visible health, no silent loss
  const row = providerHealthSnapshot().find((r) => r.key === 'ollama');
  assert.ok(row && (row.fails > 0 || row.calls > 0), 'ollama failure must be recorded in health');
  delete process.env.OLLAMA_HOST;
  delete process.env.MODEL_PROVIDER;
});

test('when enabled but unreachable, the ladder slides to the remote rungs', { timeout: 90_000 }, async () => {
  // Remote rung mocked through the NVIDIA test seam (NVIDIA_API_URL) — the
  // same trick the existing regression suite uses. NO real cloud call.
  const remote = await startMockOllama((model) => `REMOTE-RUNG[${model}] took over after ollama died`);
  process.env.MODEL_PROVIDER = 'ollama';
  process.env.OLLAMA_HOST = 'http://127.0.0.1:9'; // dead local endpoint
  process.env.NVIDIA_API_URL = `http://127.0.0.1:${remote.port}/v1`;
  process.env.NVIDIA_API_KEY = 'test-seam-key';
  try {
    const order = providerOrder('');
    assert.equal(order[0], 'ollama', 'local still leads the ladder');
    assert.ok(order.includes('nvidia'), 'remote fallback present');
    const answer = await generateContent('Reply with the single word: online', 'You are JEXI OS.', null, {});
    assert.ok(typeof answer === 'string' && answer.includes('REMOTE-RUNG'),
      `the remote rungs must answer after ollama dies — got: ${String(answer).slice(0, 80)}`);
  } finally {
    remote.server.close();
    delete process.env.MODEL_PROVIDER;
    delete process.env.OLLAMA_HOST;
    delete process.env.NVIDIA_API_URL;
    delete process.env.NVIDIA_API_KEY;
  }
});

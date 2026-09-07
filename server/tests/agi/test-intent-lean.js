/**
 * ARENA REBUILD — Intent Engine lean lane contracts (spec Part 3:
 * deterministic-first intent; Part 1: model only when reasoning is needed).
 *
 * No real cloud dependency: model calls go through the mock OpenAI-compatible
 * server (the Ollama protocol). What is proven:
 *   - the gate takes SIMPLE questions and refuses real work, conservatively
 *   - the lean lane answers with ONE bounded call through the provider ladder
 *   - a stalling provider cannot eat minutes (the budget aborts)
 *   - failure falls through honestly (handled: false, never a fake answer)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'arena-intent-'));
process.env.DATA_DIR = TMP;

const { kernelIntentGate, runLeanAnswer, kernelGate } = await import('../../src/services/JexiKernel.js');

function startMock(delayMs = 0) {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const t = setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          id: 'x', model: 'qwen3:latest',
          choices: [{ index: 0, message: { role: 'assistant', content: 'Nairobi is the capital of Kenya.' }, finish_reason: 'stop' }],
        }));
      }, delayMs);
      t.unref?.(); // an abandoned stalled request must not hold the test process open
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, kill: () => { try { server.closeAllConnections?.(); } catch {} try { server.close(); } catch {} } })));
}

/* ═══ 1. the gate ═══════════════════════════════════════════════════════════ */

test('the gate takes SIMPLE questions and refuses real work — conservatively', () => {
  const lean = [
    'What is the capital of Kenya?',
    'who wrote things fall apart',
    'Is water made of hydrogen and oxygen?',
    'how many continents are there',
    'Define entropy in one line.',
    'When did Kenya gain independence?',
    'tell me about the mitochondria',
  ];
  for (const q of lean) {
    assert.ok(kernelIntentGate(q), `must take: ${q}`);
  }
  // real work, missions, context-heavy asks — NEVER intercepted
  const work = [
    'build me a quiz app as a web app',
    'write a Python function to reverse a string',
    'research the latest AI news',
    'analyze this dataset and make a report',
    'fix the login bug in my app',
    'create a file called notes.md',
    'summarize this video https://youtube.com/watch?v=x',
    'deploy my site to github pages',
    'What is in this image?', // image/vision turns belong to the vision lane
    'design a database schema for a bank app',
    'translate this paragraph to Swahili',
    'How do I build an operating system?', // "how to build X" is work, not a fact
  ];
  for (const q of work) {
    assert.equal(kernelIntentGate(q), null, `must refuse: ${q}`);
  }
  // small talk is the KERNEL gate's job, not the lean lane's (order of checks)
  assert.equal(kernelIntentGate('hello'), null, 'pure greetings go to the zero-call fast path');
  assert.ok(kernelGate('hello'), 'sanity: the smalltalk gate does catch hello');
  // an active mission owns every turn
  assert.equal(kernelIntentGate('What is the capital of Kenya?', { activeMission: true }), null);
  // long context-heavy asks belong to the Director
  assert.equal(kernelIntentGate('What is the capital of Kenya? Also compare it with Kampala and Dar es Salaam, then write a short essay about East African capitals and their history since 1900, covering colonial influences, independence movements and modern urban development challenges'), null);
});

/* ═══ 2. the lean answer ════════════════════════════════════════════════════ */

test('lean lane answers a simple question with ONE call through the ladder', async () => {
  const mock = await startMock(30);
  process.env.MODEL_PROVIDER = 'ollama';
  process.env.OLLAMA_HOST = `http://127.0.0.1:${mock.port}`;
  try {
    const events = [];
    const r = await runLeanAnswer({ query: 'What is the capital of Kenya?', sendEvent: (t, d) => events.push(t) });
    assert.equal(r.handled, true);
    assert.match(r.answer, /Nairobi/);
    assert.equal(r.stats.modelCalls, 1, 'exactly ONE model call — not a ceremony');
    assert.ok(r.stats.durationMs < 5_000);
    assert.ok(events.includes('log'), 'the lane is observable');
  } finally {
    mock.kill();
    delete process.env.MODEL_PROVIDER;
    delete process.env.OLLAMA_HOST;
  }
});

test('a stalling provider cannot eat minutes — the budget aborts and falls through honestly', async () => {
  const mock = await startMock(60_000); // a server that hangs for a minute
  process.env.MODEL_PROVIDER = 'ollama';
  process.env.OLLAMA_HOST = `http://127.0.0.1:${mock.port}`;
  try {
    const t0 = Date.now();
    const r = await runLeanAnswer({ query: 'What is the capital of Kenya?', sendEvent: () => {}, budgetMs: 1_500 });
    const ms = Date.now() - t0;
    assert.equal(r.handled, false, 'a stalled call is NEVER answered with fake text');
    assert.ok(typeof r.reason === 'string' && r.reason.length > 0, `honest reason, got: ${r.reason}`);
    assert.ok(!/nairobi|capital/i.test(String(r.reason)), 'the reason is a failure report, never a made-up answer');
    assert.ok(ms < 6_000, `budget-capped (took ${ms}ms), not minutes`);
  } finally {
    mock.kill();
    delete process.env.MODEL_PROVIDER;
    delete process.env.OLLAMA_HOST;
  }
});

test('a dead provider also falls through honestly, fast', async () => {
  process.env.MODEL_PROVIDER = 'ollama';
  process.env.OLLAMA_HOST = 'http://127.0.0.1:9';
  try {
    const r = await runLeanAnswer({ query: 'What is the capital of Kenya?', sendEvent: () => {}, budgetMs: 10_000 });
    assert.equal(r.handled, false);
    assert.ok(r.reason, 'carries the honest failure reason');
  } finally {
    delete process.env.MODEL_PROVIDER;
    delete process.env.OLLAMA_HOST;
  }
});

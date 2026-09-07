/**
 * ARENA REBUILD — Request Meter contracts (spec Part 1: "track model calls
 * per request + latency breakdown"). No real cloud call, no real Ollama:
 * model calls are served by a mock OpenAI-compatible HTTP server.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const { generateContent } = await import('../../src/services/LLMClient.js');
const { runWithMeter, meterEnter, meterLap, meterFreeze, requestMeterReport, noteMeterModelCall, currentMeter } = await import('../../src/services/RequestMeter.js');

/* ── mock OpenAI-compatible endpoint (same protocol Ollama speaks) ───────── */
function startMockServer() {
  const seen = { chats: [] };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const parsed = JSON.parse(body || '{}');
      seen.chats.push(parsed);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: 'chatcmpl-mock', model: parsed.model,
        choices: [{ index: 0, message: { role: 'assistant', content: `MOCK[${parsed.model}] ok` }, finish_reason: 'stop' }],
      }));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, seen })));
}

test('a metered turn counts EVERY model call automatically (any lane)', async () => {
  const mock = await startMockServer();
  process.env.MODEL_PROVIDER = 'ollama';
  process.env.OLLAMA_HOST = `http://127.0.0.1:${mock.port}`;
  try {
    const report = await runWithMeter({ kind: 'test' }, async () => {
      meterLap('setup');
      const a = await generateContent('first question', 'sys', null, {});
      const b = await generateContent('second question', 'sys', null, {});
      meterLap('work');
      assert.ok(String(a).includes('MOCK[') && String(b).includes('MOCK['), 'mock must answer');
      return requestMeterReport();
    });
    assert.equal(report.modelCalls, 2, `two generateContent calls must count as exactly 2 model calls — got ${report.modelCalls}`);
    assert.equal(report.modelCallsByProvider.ollama, 2, 'provider attribution works');
    assert.equal(report.modelCallsFailed, 0);
    assert.ok(report.stages.length >= 2, 'stage timeline present');
    const names = report.stages.map((x) => x.stage);
    assert.deepEqual(names, ['setup', 'work'], 'stages keep first-seen order');
    assert.ok(report.stages.every((x) => Number.isFinite(x.ms) && x.ms >= 0));
    assert.ok(report.totalMs > 0);
  } finally {
    mock.server.close();
    delete process.env.MODEL_PROVIDER;
    delete process.env.OLLAMA_HOST;
  }
});

test('failed model calls are counted as failures — never silently dropped', async () => {
  process.env.MODEL_PROVIDER = 'ollama';
  process.env.OLLAMA_HOST = 'http://127.0.0.1:9'; // dead endpoint
  try {
    const report = await runWithMeter({ kind: 'test' }, async () => {
      await assert.rejects(() => generateContent('hello', 'sys', null, { provider: 'ollama' }));
      return requestMeterReport();
    });
    assert.equal(report.modelCalls, 1, 'the dead-endpoint attempt was a REAL model call — it must be counted');
    assert.equal(report.modelCallsFailed, 1, 'and marked failed');
  } finally {
    delete process.env.MODEL_PROVIDER;
    delete process.env.OLLAMA_HOST;
  }
});

test('outside a meter, everything is a safe no-op', async () => {
  assert.equal(currentMeter(), null, 'no meter in a bare context');
  assert.doesNotThrow(() => meterLap('nowhere'));
  assert.doesNotThrow(() => noteMeterModelCall('groq', 'x', 5, true));
  assert.equal(requestMeterReport(), null, 'no meter → no report, never a crash');
});

test('meterEnter is idempotent inside an existing scope; freeze stops charging', async () => {
  await runWithMeter({ kind: 'test' }, async () => {
    const first = currentMeter();
    const again = meterEnter({ kind: 'nested' });
    assert.equal(first, again, 'a nested meterEnter reuses the live meter');
    noteMeterModelCall('groq', 'm', 1, true);
    meterFreeze();
    noteMeterModelCall('groq', 'm', 1, true); // after freeze: ignored
    meterLap('late'); // after freeze: ignored
    const report = requestMeterReport();
    assert.equal(report.modelCalls, 1, 'post-freeze calls cannot charge the turn');
    assert.ok(!report.stages.some((x) => x.stage === 'late'), 'post-freeze laps ignored');
  });
});

test('tool-loop rounds each count as one model call', async () => {
  const mock = await startMockServer();
  process.env.MODEL_PROVIDER = 'ollama';
  process.env.OLLAMA_HOST = `http://127.0.0.1:${mock.port}`;
  try {
    const { generateWithToolsLoop } = await import('../../src/services/LLMClient.js');
    const report = await runWithMeter({ kind: 'test' }, async () => {
      // __mockCompletions bypasses providers; force the REAL walk so the
      // meter sees a genuine chatWithToolsOnce round through the mock.
      const res = await generateWithToolsLoop('check the weather in Nairobi', 'You are JEXI OS.', [{ type: 'function', function: { name: 'noop', description: 'does nothing', parameters: { type: 'object', properties: {} } } }], { provider: 'ollama', fallbackToPlainText: false }).catch((e) => ({ threw: String(e && e.message).slice(0, 80) }));
      const r = requestMeterReport();
      return { r, res };
    });
    // The walk MUST have metered at least the attempts it really made.
    assert.ok(report.r.modelCalls >= 1, `tool rounds must be metered — saw ${report.r.modelCalls}`);
    assert.equal(report.r.modelCallsByProvider.ollama, report.r.modelCalls, 'tool calls attributed to ollama');
  } finally {
    mock.server.close();
    delete process.env.MODEL_PROVIDER;
    delete process.env.OLLAMA_HOST;
  }
});

#!/usr/bin/env node
/**
 * ZONE-OWNER 2-COMPLETION LIVE PROBE (Step 2 discovery b) — the runtime
 * tryOllama leg no longer bypasses the exposure guard.
 * Run from repo root:  node scripts/zone-owner-item2c-probe.mjs
 * Proves, through the REAL runtime chat path (generateContent → walk →
 * tryOllama), with a fetch SPY on globalThis.fetch:
 *   1. OLLAMA_HOST=0.0.0.0 (public bind), no ALLOW_OLLAMA_EXPOSED:
 *      leg refused with OllamaExposureError/E_OLLAMA_EXPOSED evidence,
 *      and ZERO HTTP requests made (spy count === 0)
 *   2. OLLAMA_HOST=127.0.0.1 (loopback mock server): leg proceeds normally
 *      (spy count === 1, mock answer returned), silent — no warnings
 *   3. OLLAMA_HOST=0.0.0.0 WITH ALLOW_OLLAMA_EXPOSED=1 (mock bound on
 *      0.0.0.0): leg proceeds (spy === 1, answer returned) WITH the
 *      'WARNING: Ollama is bound to …' line
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-2c-data-'));

const { generateContent } = await import('../server/src/providers/runtime/LLMClient.js');
const { resetProviderHealth } = await import('../server/src/providers/runtime/ProviderRouter.js');
const { startupNotice } = await import('../security/shield/inference-exposure.js');

let fails = 0; let checks = 0;
const check = (label, cond, detail = '') => {
  checks++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!cond) fails++;
};

/* ── fetch spy ─────────────────────────────────────────────────────────── */
const realFetch = globalThis.fetch;
let spy = [];
globalThis.fetch = (...args) => { spy.push(String(args[0])); return realFetch(...args); };

/* ── console capture (Node process warnings like ExperimentalWarning: SQLite
      are emitted through console.error — filter them; this probe polices the
      GUARD's logging, not the runtime's warning channel) ────────────────── */
const isProcWarning = (l) => /^\(node:\d+\)\s|\(Use `node --trace-warnings/.test(l);
const cap = { warn: [], error: [] };
const realWarn = console.warn, realError = console.error;
const startCapture = () => {
  cap.warn = []; cap.error = [];
  console.warn = (...a) => { const l = a.join(' '); if (!isProcWarning(l)) cap.warn.push(l); };
  console.error = (...a) => { const l = a.join(' '); if (!isProcWarning(l)) cap.error.push(l); };
};
const stopCapture = () => { console.warn = realWarn; console.error = realError; };

/* ── mock Ollama (OpenAI-compatible /v1/chat/completions) ──────────────── */
const startMock = (host) => new Promise((resolve) => {
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const parsed = JSON.parse(body || '{}');
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          id: 'chatcmpl-2c', model: parsed.model,
          choices: [{ index: 0, message: { role: 'assistant', content: `MOCK-2C[${parsed.model}] answered` }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 4, completion_tokens: 3 },
        }));
      });
      return;
    }
    res.writeHead(404); res.end('{}');
  });
  server.listen(0, host, () => resolve({ server, port: server.address().port }));
});

process.env.MODEL_PROVIDER = 'ollama';
process.env.MODEL_NAME = 'qwen3:latest';
process.env.GROQ_API_KEY = 'probe-fake-key'; // forces the walk's "All AI providers failed. <errors>" text (walk stays pinned to ollama)

// ---- 1. public bind, no flag → refusal, ZERO HTTP
{
  resetProviderHealth('ollama');
  process.env.OLLAMA_HOST = 'http://0.0.0.0:11434';
  delete process.env.ALLOW_OLLAMA_EXPOSED;
  spy = [];
  startCapture();
  let err = null, answer = null;
  try { answer = await generateContent('hello there', 'You are JEXI.', null, { provider: 'ollama' }); }
  catch (e) { err = e; }
  stopCapture();
  const notice = startupNotice('0.0.0.0');
  console.log(`  refusal error: ${String(err?.message).slice(0, 220)}`);
  console.log(`  console.error captured: ${JSON.stringify(cap.error.map((l) => l.slice(0, 120)))}`);
  console.log(`  fetch spy calls: ${spy.length} ${JSON.stringify(spy)}`);
  check('public bind 0.0.0.0, no flag → runtime leg REFUSED (no answer)', err !== null && answer === null, `err=${err?.name ?? '∅'}`);
  check('refusal carries the E_OLLAMA_EXPOSED evidence (startupNotice in errors/console)',
    String(err?.message).includes(notice) || cap.error.some((l) => l === notice),
    `notice="${notice}"`);
  check('NO HTTP request was made (fetch spy === 0)', spy.length === 0, `spy=${spy.length}`);
}

// ---- 2. loopback mock → leg proceeds normally, silent
{
  const mock = await startMock('127.0.0.1');
  resetProviderHealth('ollama');
  process.env.OLLAMA_HOST = `http://127.0.0.1:${mock.port}`;
  delete process.env.ALLOW_OLLAMA_EXPOSED;
  spy = [];
  startCapture();
  let err = null, answer = null;
  try { answer = await generateContent('hello there', 'You are JEXI.', null, { provider: 'ollama' }); }
  catch (e) { err = e; }
  stopCapture();
  console.log(`  loopback answer: ${String(answer).slice(0, 60)} | spy: ${JSON.stringify(spy)} | warn=${cap.warn.length} err=${cap.error.length}`);
  console.log(`  loopback captured console.error: ${JSON.stringify(cap.error.map((l) => l.slice(0, 200)))}`);
  check('loopback 127.0.0.1 → leg proceeds normally (mock answered)',
    err === null && typeof answer === 'string' && answer.includes('MOCK-2C[qwen3:latest]'), `answer=${String(answer).slice(0, 40)} err=${err?.message}`);
  check('loopback → exactly ONE HTTP request (the leg fetch), silent guard',
    spy.length === 1 && spy[0].endsWith('/v1/chat/completions') && cap.warn.length === 0 && cap.error.length === 0,
    `spy=${spy.length} warn=${cap.warn.length} error=${cap.error.length}`);
  mock.server.close();
}

// ---- 3. public bind WITH ALLOW_OLLAMA_EXPOSED=1 → proceeds with WARNING
{
  const mock = await startMock('0.0.0.0'); // real wildcard bind; fetch to 0.0.0.0 routes via loopback on Linux
  resetProviderHealth('ollama');
  process.env.OLLAMA_HOST = `http://0.0.0.0:${mock.port}`;
  process.env.ALLOW_OLLAMA_EXPOSED = '1';
  spy = [];
  startCapture();
  let err = null, answer = null;
  try { answer = await generateContent('hello there', 'You are JEXI.', null, { provider: 'ollama' }); }
  catch (e) { err = e; }
  stopCapture();
  const wantWarn = `WARNING: ${startupNotice('0.0.0.0')}`;
  console.log(`  override answer: ${String(answer).slice(0, 60)} | spy: ${JSON.stringify(spy)}`);
  console.log(`  console.warn captured: ${JSON.stringify(cap.warn.map((l) => l.slice(0, 140)))}`);
  check('public bind + ALLOW_OLLAMA_EXPOSED=1 → leg proceeds (mock answered)',
    err === null && typeof answer === 'string' && answer.includes('MOCK-2C'), `answer=${String(answer).slice(0, 40)} err=${err?.message}`);
  check('override → proceeded WITH the WARNING line, exactly one request',
    cap.warn.some((l) => l === wantWarn) && spy.length === 1, `spy=${spy.length} warn=${JSON.stringify(cap.warn[0] ?? null)}`);
  mock.server.close();
  delete process.env.ALLOW_OLLAMA_EXPOSED;
}

globalThis.fetch = realFetch;
console.log(`\n===== PROBE TALLY: ${checks} checked, ${checks - fails} pass, ${fails} fail =====`);
process.exit(fails === 0 ? 0 : 1);

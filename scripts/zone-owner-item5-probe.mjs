#!/usr/bin/env node
/**
 * ZONE-OWNER ITEM 5 LIVE PROBE — cost caps consulted on the live model-call path.
 * Run from repo root:  node scripts/zone-owner-item5-probe.mjs
 * Proves:
 *   1. session spend above cap → next generateContent REFUSED with
 *      E_SESSION_CAPPED (terminal — not a ladder slide, no mock call made)
 *   2. fresh session → normal call succeeds (mock provider answers)
 *   3. no budget configured anywhere → E_NO_BUDGET passes through (zero
 *      behavior change for deployments without caps)
 *   4. cross-restart persistence: a CHILD process (fresh import, parent state
 *      dead) still refuses the capped session and still serves a fresh one —
 *      the cap survives process death via JEXI_COST_LEDGER_PATH
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LEDGER = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'caps-probe-')), 'ledger.json');

// Env MUST be set before the caps module loads (tracker persistPath is read
// at module init).
process.env.JEXI_COST_LEDGER_PATH = LEDGER;
process.env.JEXI_COST_BUDGET_USD = '1.00';

let fails = 0; let checks = 0;
const check = (label, cond, detail = '') => {
  checks++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!cond) fails++;
};

/* ── mock Ollama (OpenAI-compatible), same seam as tests/agi/test-ollama-provider.js ── */
let mockCalls = 0;
const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/v1/chat/completions') {
    mockCalls++;
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const parsed = JSON.parse(body || '{}');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: 'chatcmpl-caps-probe', model: parsed.model,
        choices: [{ index: 0, message: { role: 'assistant', content: `MOCK-OK[${parsed.model}]` }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 2 },
      }));
    });
    return;
  }
  res.writeHead(404); res.end('{}');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const MOCK = `http://127.0.0.1:${server.address().port}`;
process.env.MODEL_PROVIDER = 'ollama';
process.env.OLLAMA_HOST = MOCK;
process.env.MODEL_NAME = 'qwen3:latest';

const { generateContent } = await import('../server/src/providers/runtime/LLMClient.js');
const { caps } = await import('../integrations/providers/cost/caps.js');

// ---- 1. fake spend above cap → refusal
caps.record({ sessionId: 'probe-capped', providerId: 'groq', usd: 1.5, budgetUsd: 1.0 }); // crossing record accepted, flips terminal
const before = mockCalls;
let cappedErr = null; let cappedAnswer = null;
try { cappedAnswer = await generateContent('hello', 'sys', null, { costSessionId: 'probe-capped' }); }
catch (e) { cappedErr = e; }
check('spend above cap → next call refused with E_SESSION_CAPPED',
  cappedErr !== null && cappedErr.code === 'E_SESSION_CAPPED' && cappedAnswer === null,
  `err=${cappedErr?.name}(${cappedErr?.code}) answer=${cappedAnswer}`);
check('refusal is TERMINAL — the provider ladder never slid (mock got 0 calls)',
  mockCalls === before, `mockCalls before=${before} after=${mockCalls}`);
console.log(`  refusal message: ${String(cappedErr?.message).slice(0, 160)}`);

// ---- 2. fresh session → normal call succeeds
const fresh = await generateContent('hello', 'sys', null, { costSessionId: 'probe-fresh' });
check('fresh session → normal call succeeds through the same gate',
  typeof fresh === 'string' && fresh.includes('MOCK-OK') && mockCalls === before + 1,
  `answer=${String(fresh).slice(0, 40)} mockCalls=${mockCalls}`);

// ---- 3. no budget anywhere → E_NO_BUDGET pass-through (zero behavior change)
{
  delete process.env.JEXI_COST_BUDGET_USD;
  let nobudgetErr = null; let nobudget = null;
  try { nobudget = await generateContent('hello', 'sys', null, { costSessionId: 'probe-nobudget' }); }
  catch (e) { nobudgetErr = e; }
  check('no budget configured → caps pass through silently (E_NO_BUDGET ≠ refusal)',
    nobudgetErr === null && typeof nobudget === 'string' && nobudget.includes('MOCK-OK'),
    `err=${nobudgetErr?.code ?? '∅'} answer=${String(nobudget).slice(0, 40)}`);
  process.env.JEXI_COST_BUDGET_USD = '1.00';
}

// ---- 4. cross-restart persistence — child process, fresh module state
console.log(`  ledger file: ${LEDGER} (${fs.statSync(LEDGER).size} bytes on disk before restart)`);
const childCode = `
  process.env.JEXI_COST_LEDGER_PATH = ${JSON.stringify(LEDGER)};
  process.env.MODEL_PROVIDER = 'ollama';
  process.env.OLLAMA_HOST = ${JSON.stringify(MOCK)};
  process.env.MODEL_NAME = 'qwen3:latest';
  const { generateContent } = await import(${JSON.stringify(path.join(ROOT, 'server/src/providers/runtime/LLMClient.js'))});
  const out = { capped: null, fresh: null };
  try { out.capped = { answer: await generateContent('hi', 'sys', null, { costSessionId: 'probe-capped' }) }; }
  catch (e) { out.capped = { code: e.code, name: e.name }; }
  try { out.fresh = { answer: await generateContent('hi', 'sys', null, { costSessionId: 'probe-child-fresh', costBudgetUsd: 1.0 }) }; }
  catch (e) { out.fresh = { code: e.code, name: e.name }; }
  console.log('CHILD-RESULT ' + JSON.stringify(out));
`;
const child = spawn(process.execPath, ['--input-type=module', '-e', childCode], {
  cwd: ROOT, env: { ...process.env, NODE_NO_WARNINGS: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
});
let childOut = '';
child.stdout.on('data', (d) => { childOut += d; });
child.stderr.on('data', (d) => { childOut += d; });
const childDone = await new Promise((r) => child.on('close', r));
const marker = childOut.split('\n').find((l) => l.startsWith('CHILD-RESULT '));
const childResult = marker ? JSON.parse(marker.slice('CHILD-RESULT '.length)) : null;
check('AFTER PROCESS DEATH: capped session still refused with E_SESSION_CAPPED in a fresh process',
  childDone === 0 && childResult?.capped?.code === 'E_SESSION_CAPPED',
  `child exit=${childDone} capped=${JSON.stringify(childResult?.capped)}`);
check('AFTER PROCESS DEATH: a fresh session still gets normal service',
  typeof childResult?.fresh?.answer === 'string' && childResult.fresh.answer.includes('MOCK-OK'),
  `fresh=${JSON.stringify(childResult?.fresh)?.slice(0, 80)}`);
const persisted = JSON.parse(fs.readFileSync(LEDGER, 'utf-8'));
const cappedEntry = (persisted.sessions || []).find?.((s) => s.sessionId === 'probe-capped') ?? persisted.sessions?.['probe-capped'];
check('ledger on disk shows the terminal cap flag', Boolean(cappedEntry?.capped),
  `capped=${cappedEntry?.capped} cappedAt=${cappedEntry?.cappedAt ?? '∅'}`);

server.close();
console.log(`\n===== PROBE TALLY: ${checks} checked, ${checks - fails} pass, ${fails} fail =====`);
process.exit(fails === 0 ? 0 : 1);

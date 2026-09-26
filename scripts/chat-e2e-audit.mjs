#!/usr/bin/env node
/**
 * JEXI OS — CHAT E2E AUDIT (fix/chat-memory-provider-wiring, Part D).
 *
 *   1. Boots the server (or assumes it's already serving on :3002).
 *   2. Sends 5 consecutive messages on ONE session id.
 *   3. Asserts each turn returns a non-error response.
 *   4. Asserts turn 5 remembers the fact stated in turn 1.
 *   5. Prints a PASS/FAIL table + timing + provider used per turn.
 *   6. Saves the full trace to docs/CHAT-E2E-AUDIT.md.
 *
 * Headless/keyless-safe: with NO model keys the configured-first chain
 * (Part B) slides to the keyless pollinations floor and turns still
 * complete — the fail-soft guarantee this branch is proving. With
 * GROQ_API_KEY set (lead's laptop) turn #1 must report provider=groq.
 *
 * Run: node scripts/chat-e2e-audit.mjs
 *      JEXI_E2E_BASE=http://127.0.0.1:3002 node scripts/chat-e2e-audit.mjs
 */

import fs from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SERVER_DIR = path.join(REPO_ROOT, 'server');
const DOC = path.join(REPO_ROOT, 'docs', 'CHAT-E2E-AUDIT.md');
const BASE = process.env.JEXI_E2E_BASE || 'http://127.0.0.1:3002';
const SESSION = `e2e-audit-${Date.now()}`;
const NAME = process.env.JEXI_E2E_NAME || 'Zephyr';
const CITY = process.env.JEXI_E2E_CITY || 'Nairobi';

const TURNS = [
  `my name is ${NAME}, remember it`,
  `what is 2 + 2?`,
  `what is the capital of France?`,
  `my favorite city is ${CITY}, remember that too`,
  `what is my name and what is my favorite city? (answer in one short line)`,
];
const TURN5_EXPECTS = [NAME, CITY];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const trace = [];
const log = (s) => { console.log(s); trace.push(s); };

async function alive() {
  for (const p of ['/api/health', '/api/status', '/']) {
    try { const r = await fetch(`${BASE}${p}`, { signal: AbortSignal.timeout(2500) }); if (r) return true; } catch { /* next */ }
  }
  return false;
}

async function ensureServer() {
  if (await alive()) { log(`[boot] server already serving on ${BASE}`); return null; }
  log('[boot] no server on :3002 — spawning one…');
  const child = spawn(process.execPath, ['index.js'], { cwd: SERVER_DIR, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const t0 = Date.now();
  while (Date.now() - t0 < 90_000) {
    if (await alive()) { log(`[boot] server up in ${((Date.now() - t0) / 1000).toFixed(1)}s`); return child; }
    if (child.exitCode !== null) { log(`[boot] server exited (${child.exitCode}):\n${out.slice(-2500)}`); throw new Error('server failed to boot'); }
    await sleep(1000);
  }
  log(`[boot] timeout. tail:\n${out.slice(-2500)}`);
  throw new Error('server boot timeout');
}

async function sendTurn(query) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-jexi-session': SESSION },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(180_000),
  });
  if (res.status !== 200) return { query, error: `HTTP ${res.status}`, ms: Date.now() - t0, events: [] };
  const text = await res.text();
  const events = text.split('\n').filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const done = events.find((e) => e.type === 'done') || null;
  const meterCalls = done?.statistics?.meter?.calls || [];
  const provider = done?.statistics?.provider || (meterCalls.length ? String(meterCalls.at(-1)).split(':')[0] : 'unknown');
  const model = meterCalls.length ? String(meterCalls.at(-1)).split(':').slice(1).join(':') : null;
  return { query, events, done, provider, model, meterCalls, ms: Date.now() - t0, streamed: events.filter((e) => e.type === 'stream').map((e) => e.text || '').join('') };
}

const server = await ensureServer();
let failures = 0;
const rows = [];
try {
  log(`\n== CHAT E2E AUDIT — session ${SESSION} — ${TURNS.length} turns ==`);
  log(`keys: GROQ_API_KEY=${process.env.GROQ_API_KEY ? 'set' : 'unset'} GEMINI_API_KEY=${process.env.GEMINI_API_KEY ? 'set' : 'unset'} OPENROUTER_API_KEY=${process.env.OPENROUTER_API_KEY ? 'set' : 'unset'}`);
  const results = [];
  for (let i = 0; i < TURNS.length; i++) {
    if (i > 0) await sleep(15000); // keyless free-tier pacing — a keyed host (groq) does not need this
    results.push(await sendTurn(TURNS[i]));
  }

  results.forEach((r, i) => {
    const summary = String(r.done?.summary || r.streamed || '');
    const nonError = Boolean(r.done) && r.done.success !== false && !/degraded mode|No coworker completed/i.test(summary);
    let expect = '';
    if (i === TURNS.length - 1) {
      const missing = TURN5_EXPECTS.filter((x) => !summary.toLowerCase().includes(String(x).toLowerCase()));
      expect = missing.length ? `memory MISSING: ${missing.join(', ')}` : `remembered: ${TURN5_EXPECTS.join(' + ')}`;
      if (missing.length) failures++;
    }
    if (!nonError) failures++;
    rows.push({ n: i + 1, query: r.query, pass: nonError, provider: r.provider || '—', model: r.model || null, ms: r.ms, summary, expect });
  });

  // PASS/FAIL table
  log('\n| # | query | result | provider | time | note |');
  log('|---|-------|--------|----------|------|------|');
  for (const r of rows) {
    log(`| ${r.n} | ${r.query.replace(/\|/g, '/').slice(0, 46)} | ${r.pass ? 'PASS' : 'FAIL'} | ${r.provider}${r.model ? ` · ${r.model}` : ''} | ${(r.ms / 1000).toFixed(1)}s | ${r.expect || String(r.summary || '').replace(/\n/g, ' ').slice(0, 60)} |`);
  }
  const memoryRow = rows.at(-1);
  log(`\n== RESULT: ${rows.filter((r) => r.pass).length}/${rows.length} turns completed non-error — turn 5 memory: ${memoryRow.expect || 'OK'} — ${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`} ==`);
  log('\n-- turn 5 raw answer --');
  log(String(memoryRow.summary || '').slice(0, 900));
  if (failures) process.exitCode = 1;
} catch (e) {
  log(`\n== AUDIT ERROR: ${e.message} ==`);
  process.exitCode = 1;
} finally {
  if (server) { try { server.kill('SIGTERM'); } catch { /* exit anyway */ } }
  try {
    const header = `# CHAT E2E AUDIT — fix/chat-memory-provider-wiring\n\n- session: \`${SESSION}\`\n- base: ${BASE}\n- date: ${new Date().toISOString()}\n- env: GROQ_API_KEY=${process.env.GROQ_API_KEY ? 'set' : 'unset'}, GEMINI_API_KEY=${process.env.GEMINI_API_KEY ? 'set' : 'unset'}, OPENROUTER_API_KEY=${process.env.OPENROUTER_API_KEY ? 'set' : 'unset'}\n`;
    fs.writeFileSync(DOC, `${header}\n${trace.join('\n')}\n`);
    console.log(`[trace] saved → docs/CHAT-E2E-AUDIT.md`);
  } catch (e) { console.error(`[trace] could not save: ${e.message}`); }
}

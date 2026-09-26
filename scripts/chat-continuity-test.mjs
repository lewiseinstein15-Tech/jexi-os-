#!/usr/bin/env node
/**
 * JEXI OS — CHAT CONTINUITY TEST (fix/chat-memory-provider-wiring, Part C3).
 *
 * Lead's acceptance test, verbatim:
 *   1. Sends turn 1:  "my name is X"
 *   2. Sends turn 2:  "what is my name?"
 *   3. Asserts the second answer contains X.
 *
 * Both turns ride the SAME session id (x-jexi-session header) so the
 * server-side per-session store (B66: DATA_DIR/sessions/<sha1>.json) and the
 * JEXI-brain recall (Part C2) are exercised exactly like a real chat.
 *
 * Boots the server if :3002 is not already serving (uses the keyless
 * pollinations floor when no model keys are set — the turn must still
 * COMPLETE; that is the Part B3 fail-soft guarantee).
 *
 * Run: node scripts/chat-continuity-test.mjs            (repo root)
 *      JEXI_E2E_BASE=http://127.0.0.1:3002 node scripts/chat-continuity-test.mjs
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SERVER_DIR = path.join(REPO_ROOT, 'server');
const BASE = process.env.JEXI_E2E_BASE || 'http://127.0.0.1:3002';
const SESSION = `continuity-test-${Date.now()}`;
const NAME = process.env.JEXI_E2E_NAME || 'Zephyr';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function alive() {
  for (const p of ['/api/health', '/api/status', '/']) {
    try { const r = await fetch(`${BASE}${p}`, { signal: AbortSignal.timeout(2500) }); if (r) return true; } catch { /* try next */ }
  }
  return false;
}

async function ensureServer() {
  if (await alive()) { console.log(`[boot] server already serving on ${BASE}`); return null; }
  console.log('[boot] no server on :3002 — spawning one…');
  const child = spawn(process.execPath, ['index.js'], { cwd: SERVER_DIR, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const t0 = Date.now();
  while (Date.now() - t0 < 90_000) {
    if (await alive()) { console.log(`[boot] server up in ${((Date.now() - t0) / 1000).toFixed(1)}s`); return child; }
    if (child.exitCode !== null) { console.error(`[boot] server exited (${child.exitCode}):\n${out.slice(-2500)}`); throw new Error('server failed to boot'); }
    await sleep(1000);
  }
  console.error(`[boot] timeout. tail:\n${out.slice(-2500)}`);
  throw new Error('server boot timeout');
}

/** POST one chat turn, consume the whole NDJSON stream, return its events.
 *  Up to 3 attempts with backoff: keyless free-tier legs (pollinations)
 *  rate-limit aggressively — with a real key (groq first) the first attempt
 *  is effectively always the one. */
async function sendTurn(query) {
  let last;
  for (let attempt = 1; attempt <= 3; attempt++) {
    last = await sendTurnOnce(query);
    const summary = String(last.done?.summary || '');
    const failed = !last.done || last.done.success === false || /degraded mode|No coworker completed|No AI provider answered/i.test(summary);
    if (!failed || attempt === 3) return { ...last, attempts: attempt };
    console.log(`  [retry] turn failed (attempt ${attempt}/3) — backing off 8s`);
    await sleep(8000);
  }
  return last;
}

async function sendTurnOnce(query) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-jexi-session': SESSION },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok && res.status !== 200) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  const events = text.split('\n').filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const done = events.find((e) => e.type === 'done') || null;
  const streams = events.filter((e) => e.type === 'stream');
  const provider = done?.statistics?.provider
    || done?.statistics?.meter?.calls?.at(-1)?.split(':')?.[0]
    || (streams.length && streams[0].by ? 'streamed' : 'unknown');
  return { query, events, done, provider, ms: Date.now() - t0, streamed: streams.map((e) => e.text || '').join('') };
}

let failures = 0;
const check = (cond, label, detail = '') => {
  console.log(`  ${cond ? '✅ PASS' : '❌ FAIL'} — ${label}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
};

console.log(`\n== CHAT CONTINUITY TEST — session ${SESSION} ==`);
const server = await ensureServer();
try {
  const t1 = await sendTurn(`my name is ${NAME}`);
  const t1ok = Boolean(t1.done) && t1.done.success !== false;
  check(t1ok, `turn 1 ("my name is ${NAME}") completed`,
    t1ok ? `provider=${t1.provider} in ${(t1.ms / 1000).toFixed(1)}s (attempts: ${t1.attempts})` : `done=${JSON.stringify(t1.done)?.slice(0, 220)}`);
  // Fail-soft diagnostics: the server's own lane + classification events.
  if (!t1ok) for (const e of t1.events.filter((e) => e.type === 'log' || e.type === 'agent.log').slice(0, 12)) console.log(`    [${e.agent || 'log'}] ${String(e.message || '').slice(0, 140)}`);

  await sleep(4000); // let rememberTurn settle + free-tier pacing
  const t2 = await sendTurn('what is my name? (answer with just the name)');
  const t2Text = String(t2.done?.summary || t2.streamed || '');
  const t2ok = Boolean(t2.done) && t2.done.success !== false;
  check(t2ok, 'turn 2 ("what is my name?") completed',
    t2ok ? `provider=${t2.provider} in ${(t2.ms / 1000).toFixed(1)}s (attempts: ${t2.attempts})` : `done=${JSON.stringify(t2.done)?.slice(0, 220)}`);
  if (!t2ok) for (const e of t2.events.filter((e) => e.type === 'log' || e.type === 'agent.log').slice(0, 12)) console.log(`    [${e.agent || 'log'}] ${String(e.message || '').slice(0, 140)}`);
  check(t2Text.toLowerCase().includes(NAME.toLowerCase()), `turn 2 answer contains "${NAME}" (continuity proven)`,
    `answer: ${t2Text.slice(0, 160).replace(/\n/g, ' ')}`);

  console.log(`\n== RESULT: ${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`} ==`);
  if (failures) process.exitCode = 1;
} finally {
  if (server) { try { server.kill('SIGTERM'); } catch { /* exit anyway */ } }
}

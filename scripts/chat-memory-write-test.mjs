#!/usr/bin/env node
/**
 * JEXI OS — CHAT → BRAIN.HOT WRITE TEST (fix/chat-wiring-completion, GAP 2).
 *
 * Lead's acceptance test, verbatim:
 *   1. Send turn 1:  "my dog's name is Rusty"          (session A)
 *   2. Send turn 2:  "what did I say about my dog?"    (NEW session, same process)
 *   3. Assert she recalls "Rusty" from hot memory (cross-session).
 *
 * Turn 2's prompt block must contain the hot-memory fact written by turn 1
 * (deterministic — assertable keyless); the ANSWER assertion needs a live
 * provider (runs on the keyed laptop; keyless sandboxes ride pollinations).
 *
 * Run: node scripts/chat-memory-write-test.mjs
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SERVER_DIR = path.join(REPO_ROOT, 'server');
const BASE = process.env.JEXI_E2E_BASE || 'http://127.0.0.1:3002';
const SESSION_A = `dog-write-A-${Date.now()}`;
const SESSION_B = `dog-write-B-${Date.now()}`; // NEW session — cross-session proof
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function alive() {
  for (const p of ['/api/health', '/api/status', '/']) {
    try { const r = await fetch(`${BASE}${p}`, { signal: AbortSignal.timeout(2500) }); if (r) return true; } catch { /* next */ }
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
    if (child.exitCode !== null) { console.error(`[boot] server exited:\n${out.slice(-2000)}`); throw new Error('boot failed'); }
    await sleep(1000);
  }
  throw new Error('server boot timeout');
}

async function sendTurn(session, query) {
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-jexi-session': session },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(180_000),
  });
  const text = await res.text();
  const events = text.split('\n').filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const done = events.find((e) => e.type === 'done') || null;
  return { done, events, streamed: events.filter((e) => e.type === 'stream').map((e) => e.text || '').join('') };
}

let failures = 0;
const check = (cond, label, detail = '') => {
  console.log(`  ${cond ? '✅ PASS' : '❌ FAIL'} — ${label}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
};

console.log(`\n== CHAT → BRAIN.HOT WRITE TEST (GAP 2) ==`);
console.log(`  session A: ${SESSION_A}`);
console.log(`  session B (NEW): ${SESSION_B}`);
const server = await ensureServer();
try {
  const t1 = await sendTurn(SESSION_A, "my dog's name is Rusty");
  const t1Text = String(t1.done?.summary || t1.streamed || '');
  const t1ok = Boolean(t1.done) && t1.done.success !== false;
  check(t1ok, 'turn 1 (session A) completed', `answer: ${t1Text.slice(0, 100).replace(/\n/g, ' ')}`);
  check(/Rusty/i.test(t1Text), 'turn 1 answer acknowledges Rusty (provider echoed the fact)');

  await sleep(8000); // let the done() hot write settle + free-tier pacing
  const t2 = await sendTurn(SESSION_B, 'what did I say about my dog? (answer in one short line)');
  const t2Text = String(t2.done?.summary || t2.streamed || '');
  const t2ok = Boolean(t2.done) && t2.done.success !== false;
  check(t2ok, 'turn 2 (NEW session B) completed', `answer: ${t2Text.slice(0, 100).replace(/\n/g, ' ')}`);
  check(/Rusty/i.test(t2Text), 'CROSS-SESSION RECALL: turn 2 answer contains "Rusty" (recalled from hot memory)');

  console.log(`\n== RESULT: ${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`} ==`);
  if (failures) process.exitCode = 1;
} finally {
  if (server) { try { server.kill('SIGTERM'); } catch { /* exit anyway */ } }
}

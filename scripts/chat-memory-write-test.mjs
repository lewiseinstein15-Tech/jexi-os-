#!/usr/bin/env node
/**
 * JEXI OS — CHAT MEMORY WRITE TEST (ui/decision-layer-rendering, Part 2).
 *
 * The lead's three acceptance tests, over REAL HTTP against a REAL server:
 *
 *   T1 — same-session continuity: turn N+1 sees turn N in the same session
 *   T2 — new-chat isolation: a fresh session does NOT see prior private turns
 *   T3 — cross-session global memory: user preferences carry over sessions
 *
 * Plus the Part 2 write-contract check: every completed turn writes the
 * STRUCTURED {user, assistant, ts, sessionId} payload to brain.hot and the
 * durable DATA_DIR/brain-hot-chat.jsonl log.
 *
 * Deterministic by design: the server runs keyless (sandbox has no model
 * keys), so the agentic lane's deterministic runners answer the turns —
 * the memory loop itself is what is under test, not an LLM's wording.
 *
 * Run: node scripts/chat-memory-write-test.mjs            (repo root)
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SERVER_DIR = path.join(REPO_ROOT, 'server');
const PORT = process.env.JEXI_MW_PORT || '3012';
const BASE = `http://127.0.0.1:${PORT}`;
const NAME = process.env.JEXI_MW_NAME || 'Lewis';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const record = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

/* ── isolated server (fresh DATA_DIR → no leakage from prior runs) ────── */
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-mw-test-'));
let server = null;
let serverLog = '';

async function alive() {
  try { const r = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(2000) }); return r.ok || r.status < 500; } catch { return false; }
}

async function boot() {
  server = spawn(process.execPath, ['index.js'], {
    cwd: SERVER_DIR,
    env: { ...process.env, PORT: String(PORT), DATA_DIR, HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (d) => { serverLog += d; });
  server.stderr.on('data', (d) => { serverLog += d; });
  const t0 = Date.now();
  while (Date.now() - t0 < 90_000) {
    if (await alive()) { console.log(`[boot] server up on :${PORT} in ${((Date.now() - t0) / 1000).toFixed(1)}s (DATA_DIR=${DATA_DIR})`); return; }
    if (server.exitCode !== null) { console.error(serverLog.slice(-3000)); throw new Error(`server exited early (${server.exitCode})`); }
    await sleep(800);
  }
  throw new Error('server boot timeout\n' + serverLog.slice(-3000));
}

/* ── one chat turn over real NDJSON HTTP ──────────────────────────────── */
async function turn(sessionId, query) {
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-jexi-session': sessionId },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  const events = text.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const done = events.find((e) => e.type === 'done');
  return { status: res.status, events, done, summary: done?.summary || '', success: done?.success !== false };
}

function sessionFile(sessionId) {
  const p = path.join(DATA_DIR, 'sessions', `${createHash('sha1').update(String(sessionId)).digest('hex').slice(0, 24)}.json`);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf-8')) : null;
}

/* ── the three acceptance tests ───────────────────────────────────────── */
try {
  await boot();
  const SA = `mw-a-${Date.now()}`;
  const SB = `mw-b-${Date.now()}`;

  console.log('\n── warm-up: session A, turn 1 — "my name is <NAME>" ──\n');
  const t1 = await turn(SA, `my name is ${NAME}`);
  console.log(`  [A1] status=${t1.status} success=${t1.success} summary="${t1.summary.slice(0, 80)}"`);

  console.log('\n── T1 — same-session continuity ──\n');
  {
    const t2 = await turn(SA, 'what is my name?');
    console.log(`  [A2] summary="${t2.summary.slice(0, 100)}"`);
    record('T1a: same-session answer contains the name', /lewis/i.test(t2.summary), `answer: "${t2.summary.slice(0, 80)}"`);
    const store = sessionFile(SA);
    const blob = JSON.stringify(store || '');
    record('T1b: session store persists turn 1 user message', Boolean(store) && blob.includes(`my name is ${NAME}`), `file=${path.join(DATA_DIR, 'sessions', '…')} entries=${Array.isArray(store?.history) ? store.history.length : 'n/a'}`);
    record('T1c: session store persists turn 2 as well', Boolean(store) && blob.includes('what is my name?'), 'history carries both turns');
  }

  console.log('\n── T2 — new-chat isolation ──\n');
  {
    const t1b = await turn(SB, 'what is 2+2?');
    console.log(`  [B1] summary="${t1b.summary.slice(0, 80)}"`);
    const storeB = sessionFile(SB);
    const blobB = JSON.stringify(storeB || '');
    record('T2a: fresh session store exists and holds ONLY its own turn', Boolean(storeB), `entries=${Array.isArray(storeB?.history) ? storeB.history.length : 'n/a'}`);
    record('T2b: fresh session does NOT see session A private turns', !blobB.includes(`my name is ${NAME}`) && !/lewis/i.test(blobB), 'no cross-session transcript bleed');
    record('T2c: fresh session turn is itself persisted', blobB.includes('what is 2+2?'), 'its own turn is in its store');
  }

  console.log('\n── T3 — cross-session global memory ──\n');
  {
    const t2b = await turn(SB, 'what is my name?');
    console.log(`  [B2] summary="${t2b.summary.slice(0, 100)}"`);
    record('T3: preference carries across sessions (name recalled in session B)', /lewis/i.test(t2b.summary), `answer: "${t2b.summary.slice(0, 80)}"`);
  }

  console.log('\n── Part 2 write contract — structured durable brain.hot turns ──\n');
  {
    const logPath = path.join(DATA_DIR, 'brain-hot-chat.jsonl');
    record('write-contract: brain-hot-chat.jsonl exists', fs.existsSync(logPath), logPath.replace(DATA_DIR, '<DATA_DIR>'));
    if (fs.existsSync(logPath)) {
      const lines = fs.readFileSync(logPath, 'utf-8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      const shaped = lines.filter((r) => r.turn && typeof r.turn.user === 'string' && typeof r.turn.assistant === 'string' && typeof r.turn.ts === 'string' && r.turn.sessionId);
      record('write-contract: every line carries {user, assistant, ts, sessionId}', lines.length >= 3 && shaped.length === lines.length, `${shaped.length}/${lines.length} shaped rows`);
      record('write-contract: the name turn is durably recorded', shaped.some((r) => r.turn.user.includes(`my name is ${NAME}`) && /name is/i.test(r.turn.assistant)), `ts of first row: ${shaped[0]?.turn?.ts || 'n/a'}`);
    }
  }
} catch (e) {
  record('test harness error', false, String(e && e.message || e).slice(0, 200));
} finally {
  try { if (server) server.kill('SIGTERM'); } catch { /* already gone */ }
  await sleep(500);
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
}

const passed = results.filter((r) => r.pass).length;
const total = results.length;
console.log('\n════════════════════════════════════════════════════════');
console.log(` RESULT: ${passed}/${total} PASS`);
console.log('════════════════════════════════════════════════════════');
process.exit(passed === total ? 0 : 1);

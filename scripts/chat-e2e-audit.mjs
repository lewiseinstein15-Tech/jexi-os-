#!/usr/bin/env node
/**
 * JEXI OS — CHAT WIRING COMPLETION — INTEGRATED E2E AUDIT (Part B, T1–T9).
 *
 * One run covers all six GAPs of fix/chat-wiring-completion:
 *   T1  GAP(P7 prior) 5 consecutive SIMPLE turns succeed; provider named
 *                      (groq when keyed — the configured-first chain).
 *   T2  continuity      turn 1 "my name is Lewis" → turn 2 "what is my
 *                      name?" → answer contains Lewis.
 *   T3  GAP 2           cross-session hot-memory recall (dog Rusty).
 *   T4  GAP 1           semantica feed (deterministic in-process suite:
 *                      server/test-chat-brain-feed.js).
 *   T5  GAP 1           instincts feed (same deterministic suite).
 *   T6  GAP 3           COMPLEX-lane coordinator brain recall —
 *                      deterministic suite (test-chat-coordinator.js) +
 *                      live 'Coordinator prompt carries brain context'
 *                      narration on a real COMPLEX turn.
 *   T7  GAP 4           "what is my name?" routes SIMPLE (Complexity:
 *                      SIMPLE logged; NO 'Plan first — team' graph marker).
 *   T8  GAP 5           x-jexi-session header honored (team event echoes
 *                      the header session id).
 *   T9  GAP 6           user message logged exactly once (session store
 *                      inspected on disk — self-booted servers only).
 *
 * Keyless-sandbox honesty: routing/persistence/narration assertions (T4,
 * T5, T6-unit, T7, T8, T9) are deterministic and pass without keys. LLM-
 * answer assertions (T1 success streak, T2, T3, T6-live, provider=groq)
 * need a live provider — on a keyless sandbox they ride the pollinations
 * floor and may flake; the lead runs this script with GROQ_API_KEY set.
 *
 * Output: PASS/FAIL table + per-turn timing + provider; trace saved to
 * docs/CHAT-WIRING-COMPLETION-AUDIT.md.
 *
 * Run: node scripts/chat-e2e-audit.mjs
 *      JEXI_E2E_BASE=http://127.0.0.1:3002 node scripts/chat-e2e-audit.mjs
 */

import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SERVER_DIR = path.join(REPO_ROOT, 'server');
const DOC = path.join(REPO_ROOT, 'docs', 'CHAT-WIRING-COMPLETION-AUDIT.md');
const BASE = process.env.JEXI_E2E_BASE || 'http://127.0.0.1:3002';
const KEYED = Boolean(process.env.GROQ_API_KEY);
const stamp = Date.now();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const trace = [];
const log = (s) => { console.log(s); trace.push(s); };

async function alive() {
  for (const p of ['/api/health', '/api/status', '/']) {
    try { const r = await fetch(`${BASE}${p}`, { signal: AbortSignal.timeout(2500) }); if (r) return true; } catch { /* next */ }
  }
  return false;
}

let selfBooted = null; // ChildProcess when this script spawned the server
async function ensureServer() {
  if (await alive()) { log(`[boot] server already serving on ${BASE}`); return; }
  log('[boot] no server on :3002 — spawning one…');
  selfBooted = spawn(process.execPath, ['index.js'], { cwd: SERVER_DIR, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  selfBooted.stdout.on('data', (d) => { out += d; });
  selfBooted.stderr.on('data', (d) => { out += d; });
  const t0 = Date.now();
  while (Date.now() - t0 < 90_000) {
    if (await alive()) { log(`[boot] server up in ${((Date.now() - t0) / 1000).toFixed(1)}s`); return; }
    if (selfBooted.exitCode !== null) { log(`[boot] server exited:\n${out.slice(-2000)}`); throw new Error('boot failed'); }
    await sleep(1000);
  }
  throw new Error('server boot timeout');
}

/** One chat turn; consumes the whole NDJSON stream. */
async function sendTurn(session, query) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-jexi-session': session },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(180_000),
    });
    const text = await res.text();
    const events = text.split('\n').filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const done = events.find((e) => e.type === 'done') || null;
    const meterCalls = done?.statistics?.meter?.calls || [];
    const provider = done?.statistics?.provider || (meterCalls.length ? String(meterCalls.at(-1)).split(':')[0] : 'unknown');
    return { done, events, provider, ms: Date.now() - t0, summary: String(done?.summary || '') , streamed: events.filter((e) => e.type === 'stream').map((e) => e.text || '').join('') };
  } catch (e) {
    return { done: null, events: [], provider: 'error', ms: Date.now() - t0, summary: `transport error: ${e.message}`, streamed: '' };
  }
}

const succeeded = (t) => Boolean(t.done) && t.done.success !== false && !/degraded mode|No coworker completed|No AI provider answered/i.test(t.summary);

// ---- results bookkeeping ----------------------------------------------------
const results = []; // { id, label, pass, detail }
const record = (id, label, pass, detail = '') => {
  results.push({ id, label, pass: Boolean(pass), detail });
  console.log(`  ${pass ? '✅ PASS' : '❌ FAIL'} — ${id} ${label}${detail ? ` — ${detail}` : ''}`);
};

const runUnitSuite = (file) => {
  const r = spawnSync(process.execPath, [file], { cwd: SERVER_DIR, encoding: 'utf8', timeout: 120_000 });
  const tail = String(r.stdout || '').split('\n').filter((l) => /RESULT|passed/.test(l)).at(-1) || `exit ${r.status}`;
  return { pass: r.status === 0, tail: tail.trim() };
};

// =============================================================================
log(`\n== CHAT WIRING COMPLETION — INTEGRATED E2E (T1–T9) ==`);
log(`keys: GROQ_API_KEY=${KEYED ? 'set' : 'unset'} (keyless runs ride the pollinations fail-soft floor)`);
await ensureServer();

try {
  // ---- T1: five consecutive SIMPLE turns ------------------------------------
  const s1 = `e2e-t1-${stamp}`;
  const t1rows = [];
  for (let i = 1; i <= 5; i++) {
    const t = await sendTurn(s1, `what is ${i} + ${i}?`);
    t1rows.push({ i, ok: succeeded(t), provider: t.provider, ms: t.ms });
    await sleep(2500);
  }
  const t1all = t1rows.every((r) => r.ok);
  const t1groq = t1rows.every((r) => String(r.provider).startsWith('groq'));
  record('T1', '5 consecutive SIMPLE turns succeed', t1all,
    t1rows.map((r) => `#${r.i}:${r.ok ? 'ok' : 'FAIL'}(${r.provider},${(r.ms / 1000).toFixed(1)}s)`).join(' '));
  record('T1b', KEYED ? 'all five turns rode groq' : 'provider per turn (groq expected on a keyed host)',
    KEYED ? t1groq : true, t1rows.map((r) => r.provider).join(','));

  // ---- T2: continuity (SIMPLE lane + session store) --------------------------
  const s2 = `e2e-t2-${stamp}`;
  const t2a = await sendTurn(s2, 'my name is Lewis, remember it');
  await sleep(6000);
  const t2b = await sendTurn(s2, 'what is my name? (answer with just the name)');
  record('T2', 'turn 2 answer contains "Lewis"', /Lewis/i.test(String(t2b.summary || t2b.streamed)),
    `t1:${succeeded(t2a) ? 'ok' : 'FAIL'} t2:${succeeded(t2b) ? 'ok' : 'FAIL'} answer: ${String(t2b.summary || t2b.streamed).slice(0, 90).replace(/\n/g, ' ')}`);

  // ---- T7 (uses T2's turn): memory query routed SIMPLE, no graph -------------
  const t2logs = t2b.events.filter((e) => e.type === 'log' || e.type === 'agent.log').map((e) => String(e.message || ''));
  const wentSimple = t2logs.some((m) => /Complexity: SIMPLE/.test(m));
  const noGraph = !t2logs.some((m) => /Plan first — team|Complexity: COMPLEX/.test(m));
  record('T7', 'GAP 4: "what is my name?" routed SIMPLE, single coworker (no 3-agent graph)', wentSimple && noGraph,
    `simple=${wentSimple} graphAvoided=${noGraph}`);

  // ---- T3: GAP 2 cross-session hot-memory recall ------------------------------
  const s3 = `e2e-t3a-${stamp}`;
  const s4 = `e2e-t3b-${stamp}`; // NEW session, same process
  const t3a = await sendTurn(s3, "my dog's name is Rusty");
  await sleep(8000);
  const t3b = await sendTurn(s4, 'what did I say about my dog? (answer in one short line)');
  record('T3', 'GAP 2: NEW session recalls "Rusty" from hot memory', /Rusty/i.test(String(t3b.summary || t3b.streamed)),
    `teach:${succeeded(t3a) ? 'ok' : 'FAIL'} ask:${succeeded(t3b) ? 'ok' : 'FAIL'} answer: ${String(t3b.summary || t3b.streamed).slice(0, 90).replace(/\n/g, ' ')}`);

  // ---- T4 + T5: GAP 1 semantica + instincts (deterministic in-process suite) --
  const feed = runUnitSuite('test-chat-brain-feed.js');
  record('T4', 'GAP 1: semantica fact seeded → present in the assembled prompt', feed.pass, feed.tail);
  record('T5', 'GAP 1: instinct seeded → present in the assembled prompt', feed.pass, 'same suite, T-b assertions');

  // ---- T6: GAP 3 COMPLEX-lane coordinator brain recall -------------------------
  const coord = runUnitSuite('test-chat-coordinator.js');
  record('T6a', 'GAP 3: coordinator one-shot feed (deterministic suite)', coord.pass, coord.tail);
  const s6 = `e2e-t6-${stamp}`;
  const t6 = await sendTurn(s6, 'build me a tiny pomodoro timer web app');
  const coordLive = t6.events.some((e) => (e.type === 'log' || e.type === 'agent.log') && /Coordinator prompt carries brain context/.test(String(e.message || '')));
  record('T6b', 'GAP 3: live COMPLEX turn narrates coordinator brain context', coordLive,
    coordLive ? 'narration observed' : 'brain block was empty (needs earlier successful turns / non-empty brain) — unit leg T6a is the hard proof');

  // ---- T8: GAP 5 session header honored ----------------------------------------
  const s8 = `e2e-t8-${stamp}`;
  const t8 = await sendTurn(s8, 'say ok');
  const echoed = t8.events.some((e) => (e.event?.conversationId ?? e.conversationId) === s8);
  record('T8', 'GAP 5: x-jexi-session header honored (conversationId echoes the header)', echoed,
    echoed ? `session=${s8}` : 'no team event echoed the header id (turn may have failed before the team lane)');

  // ---- T9: GAP 6 no double-log (session store on disk) --------------------------
  if (selfBooted) {
    const convId = s8;
    const file = path.join(SERVER_DIR, 'data', 'sessions', crypto.createHash('sha1').update(convId).digest('hex').slice(0, 24) + '.json');
    try {
      const store = JSON.parse(fs.readFileSync(file, 'utf8'));
      const userEntries = (store.history || []).filter((h) => h.role === 'user' && h.text === 'say ok');
      record('T9', 'GAP 6: exactly ONE user entry per turn in the session store', userEntries.length === 1,
        `user entries for the turn text: ${userEntries.length}; store: ${JSON.stringify(store.history?.slice(-3))?.slice(0, 240)}`);
    } catch (e) {
      record('T9', 'GAP 6: exactly ONE user entry per turn in the session store', false, `store unreadable: ${e.message}`);
    }
  } else {
    record('T9', 'GAP 6: exactly ONE user entry per turn in the session store', false, 'SKIPPED — external server, store path unknown');
  }
} catch (e) {
  record('E2E', 'unexpected harness error', false, e.message);
}

// ---- table -------------------------------------------------------------------
const fails = results.filter((r) => !r.pass).length;
log('\n== PASS/FAIL TABLE ==');
log('| id | test | result | detail |');
log('|----|------|--------|--------|');
for (const r of results) log(`| ${r.id} | ${r.label} | ${r.pass ? 'PASS' : 'FAIL'} | ${String(r.detail).replace(/\|/g, '/').slice(0, 130)} |`);
log(`\n== RESULT: ${results.filter((r) => r.pass).length}/${results.length} PASS — ${fails === 0 ? 'ALL GREEN' : `${fails} failure(s)`} ==`);
if (fails) process.exitCode = 1;

// ---- trace doc ----------------------------------------------------------------
try {
  const header = `# CHAT WIRING COMPLETION — INTEGRATED E2E AUDIT (T1–T9)\n\n- branch: fix/chat-wiring-completion\n- base: ${BASE}\n- date: ${new Date().toISOString()}\n- env: GROQ_API_KEY=${KEYED ? 'set' : 'unset'} (keyless runs ride the pollinations fail-soft floor; LLM-answer rows flake by environment, deterministic rows hold)\n`;
  fs.writeFileSync(DOC, `${header}\n${trace.join('\n')}\n`);
  console.log('[trace] saved → docs/CHAT-WIRING-COMPLETION-AUDIT.md');
} catch (e) { console.error(`[trace] save failed: ${e.message}`); }

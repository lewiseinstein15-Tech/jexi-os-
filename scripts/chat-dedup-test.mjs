#!/usr/bin/env node
/**
 * JEXI OS — GAP 6 v2 DEDUP GUARD — DETERMINISTIC COUNT TEST.
 *
 * Proves the single-writer invariant: ONE user entry per user turn, always,
 * regardless of composed text. Not sample-based — every session, every turn,
 * every run.
 *
 * Design (deterministic, keyless-safe):
 *   • Boots an ISOLATED server (own PORT + own DATA_DIR) so the session store
 *     starts empty — counts cannot be polluted by prior runs.
 *   • 3 fresh sessions × 3 turns. Turn 3 of every session deliberately
 *     re-opens the session's FIRST task ("back to the pomodoro timer web app
 *     …"). That task FAILED on turn 1 (keyless run → success:false → index.js
 *     marks it failed), so turn 3 classifies as a SWITCH to a failed task →
 *     ConversationManager attaches taskContextBlock(failed task) → DecisionEngine
 *     returns contextBlock + classification 'switch' → server/index.js:2406-2407
 *     composes  `<failed-task block>\n\nUser's follow-up: <raw>`  as the
 *     executionQuery. That composed string is exactly what sailed past the old
 *     exact-text guard and double-logged the turn (GLM's evidence).
 *   • The user entry is written by the handler BEFORE any LLM call, so the
 *     assertion is immune to keyless LLM flakiness: the turn may fail, the
 *     COUNT may not lie.
 *   • After EVERY turn the session store on disk is diffed: user entries added
 *     during that turn must be EXACTLY 1 and must carry the raw turn text.
 *   • The 'intel' event on turn 3 must say classification 'switch' — proof the
 *     failed-task compose branch was actually exercised (a run that never
 *     enters the path is a FAIL, not a pass-by-default).
 *
 * Output: per-session count table + one full store dump (P4 evidence) +
 *         final 3/3 verdict. Exit 1 unless all 3 sessions pass.
 *
 * Run: node scripts/chat-dedup-test.mjs
 */

import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SERVER_DIR = path.join(REPO_ROOT, 'server');
const PORT = process.env.JEXI_DEDUP_PORT || 3947;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = path.join(REPO_ROOT, 'scripts', `.dedup-data-${Date.now()}`);
const STAMP = Date.now();
const TURN_TIMEOUT_MS = Number(process.env.JEXI_DEDUP_TURN_MS || 120_000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (s) => console.log(s);

// ---- isolated server ---------------------------------------------------------
let server = null;
let serverOut = '';

async function alive() {
  for (const p of ['/api/health', '/api/status', '/']) {
    try { const r = await fetch(`${BASE}${p}`, { signal: AbortSignal.timeout(2000) }); if (r) return true; } catch { /* next */ }
  }
  return false;
}

async function boot() {
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });
  server = spawn(process.execPath, ['index.js'], {
    cwd: SERVER_DIR,
    env: { ...process.env, PORT: String(PORT), DATA_DIR, GROQ_API_KEY: '', OPENAI_API_KEY: '', GEMINI_API_KEY: '', OPENROUTER_API_KEY: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (d) => { serverOut += d; });
  server.stderr.on('data', (d) => { serverOut += d; });
  const t0 = Date.now();
  while (Date.now() - t0 < 90_000) {
    if (await alive()) { log(`[boot] isolated server up on :${PORT} (DATA_DIR=${DATA_DIR}) in ${((Date.now() - t0) / 1000).toFixed(1)}s`); return; }
    if (server.exitCode !== null) { log(`[boot] server exited:\n${serverOut.slice(-2000)}`); throw new Error('boot failed'); }
    await sleep(800);
  }
  throw new Error('boot timeout');
}

function shutdown() { try { server && server.kill('SIGKILL'); } catch { /* already gone */ } }

// ---- store access -------------------------------------------------------------
const sessionFile = (convId) => path.join(DATA_DIR, 'sessions', crypto.createHash('sha1').update(String(convId)).digest('hex').slice(0, 24) + '.json');

function readStore(convId) {
  try {
    const parsed = JSON.parse(fs.readFileSync(sessionFile(convId), 'utf8'));
    return Array.isArray(parsed.history) ? parsed.history : [];
  } catch { return []; }
}
const userCount = (history) => history.filter((h) => h.role === 'user').length;

// ---- one chat turn -------------------------------------------------------------
async function sendTurn(session, query) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-jexi-session': session },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(TURN_TIMEOUT_MS),
    });
    const text = await res.text();
    const events = text.split('\n').filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const done = events.find((e) => e.type === 'done') || null;
    const intel = events.filter((e) => e.type === 'intel').map((e) => e.classification).filter(Boolean);
    const logs = events.filter((e) => e.type === 'log' || e.type === 'agent.log').map((e) => String(e.message || ''));
    return { done, intel, logs, ms: Date.now() - t0, summary: String(done?.summary || ''), success: Boolean(done) && done.success !== false };
  } catch (e) {
    return { done: null, intel: [], logs: [], ms: Date.now() - t0, summary: `transport error: ${e.message}`, success: false };
  }
}

// ---- the deterministic scenario -------------------------------------------------
const SESSIONS = 3;
const TURNS = 3; // per session; turn 3 = the failed-task path
const turnText = (s, i) =>
  i === 1 ? `build me a pomodoro timer web app jexi-dedup-${STAMP}-${s}`
  : i === 2 ? `build me a notes tracker web app jexi-dedup-${STAMP}-${s}`
  : `back to the pomodoro timer web app jexi-dedup-${STAMP}-${s}`; // SWITCH to the FAILED task-1 → contextBlock prepend (index.js:2406-2407)

const results = []; // { session, turn, path, added, textOk, switchFired, pass, note }
let fatal = null;

try {
  await boot();

  for (let s = 1; s <= SESSIONS; s++) {
    const convId = `jexi-dedup-s${s}-${STAMP}`;
    let prevUserEntries = userCount(readStore(convId));
    let sawSwitch = false;

    for (let i = 1; i <= TURNS; i++) {
      const raw = turnText(`s${s}`, i);
      const t = await sendTurn(convId, raw);
      await sleep(1200); // let any trailing write settle before the snapshot
      const store = readStore(convId);
      const newUser = store.filter((h) => h.role === 'user').slice(prevUserEntries);
      const added = newUser.length;
      const textOk = newUser.every((h) => h.text === raw);
      const classification = t.intel.at(-1) || null;
      const isFailedTaskTurn = i === TURNS;
      if (classification === 'switch') sawSwitch = true;
      const switchFired = isFailedTaskTurn ? classification === 'switch' : null;
      const pass = added === 1 && textOk && (switchFired === null || switchFired === true);
      results.push({
        session: s, turn: i,
        path: isFailedTaskTurn ? 'failed-task (switch → contextBlock prepend)' : (i === 1 ? 'new-task' : 'new-task #2'),
        classification: classification || 'none',
        added, textOk, switchFired, pass,
        note: pass ? '' : (added !== 1 ? `expected exactly 1 new user entry, got ${added}` : !textOk ? 'entry text mismatch (neither raw nor sole)' : 'failed-task path NOT exercised (classification !== switch)'),
      });
      prevUserEntries += added;
      log(`  [s${s}·turn${i}] ${isFailedTaskTurn ? 'FAILED-TASK PATH' : 'plain path'} — classification=${classification || 'none'} — new user entries=${added} (${t.ms}ms, turn success=${t.success}) ${pass ? 'PASS' : 'FAIL'}`);
      await sleep(800);
    }
    if (!sawSwitch) results.filter((r) => r.session === s && r.turn === TURNS).forEach((r) => { r.pass = false; r.note = 'session never classified switch — failed-task path not exercised'; });
  }
} catch (e) {
  fatal = e.message;
} finally {
  shutdown();
}

// ---- per-session count table (P3) ----------------------------------------------
log('\n== PER-SESSION USER-ENTRY COUNT TABLE ==');
log('| session | turn | path | classification | new user entries | text==raw | verdict |');
log('|---------|------|------|----------------|------------------|-----------|---------|');
for (const r of results) {
  log(`| s${r.session} | ${r.turn} | ${r.path} | ${r.classification} | ${r.added} | ${r.textOk ? 'yes' : 'NO'} | ${r.pass ? 'PASS' : 'FAIL'}${r.note ? ` — ${r.note}` : ''} |`);
}

// ---- store dump for one session (P4) --------------------------------------------
log('\n== STORE CONTENT DUMP — SESSION 1 (full history, raw) ==');
try {
  const dump = readStore(`jexi-dedup-s1-${STAMP}`);
  for (const h of dump) log(`  role=${h.role}  text=${JSON.stringify(String(h.text || '').slice(0, 160))}`);
  log(`  (session-1 totals: ${dump.length} entries, ${userCount(dump)} user entries across ${TURNS} turns)`);
} catch (e) { log(`  (dump unavailable: ${e.message})`); }

// ---- verdict ---------------------------------------------------------------------
const bySession = [];
for (let s = 1; s <= SESSIONS; s++) {
  const rows = results.filter((r) => r.session === s);
  bySession.push({ session: s, pass: rows.length === TURNS && rows.every((r) => r.pass), rows: rows.length });
}
log('\n== VERDICT ==');
if (fatal) log(`FATAL: ${fatal} (server tail: ${serverOut.slice(-400).replace(/\n/g, ' | ')})`);
for (const b of bySession) log(`  session ${b.session}: ${b.rows}/${TURNS} turns checked — ${b.pass ? 'PASS' : 'FAIL'}`);
const passedSessions = bySession.filter((b) => b.pass).length;
log(`\nRESULT: ${passedSessions}/${SESSIONS} SESSIONS PASS — ${passedSessions === SESSIONS && !fatal ? 'INVARIANT HOLDS (exactly 1 user entry per turn, deterministic)' : 'INVARIANT VIOLATED'}`);
log(`(evidence DATA_DIR kept for inspection: ${DATA_DIR})`);
process.exit(passedSessions === SESSIONS && !fatal ? 0 : 1);

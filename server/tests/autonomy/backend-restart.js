#!/usr/bin/env node
/**
 * B211 B4 — BACKEND RESTART: a mission survives a real process kill.
 *
 * This is a REAL restart test across process boundaries (not a simulated
 * "fresh runner instance"): a child process starts a mission, the parent
 * SIGKILLs it exactly while item 2 is mid-flight (its session is gated on a
 * file the parent controls), then a SECOND process boots from nothing but
 * the persisted state and must:
 *
 *   - resume the mission via resumeOnBoot (requeue in-flight work),
 *   - NEVER redo item 1 (its DONE result survives; exactly one session ran
 *     for it across BOTH processes),
 *   - finish the mission to COMPLETED,
 *   - record the restart honestly (MISSION_RESTART_RECOVERY + usage.restarts).
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, '..', '..');
const DATA = path.join(SERVER, 'data', 'test-b211b4-rs');

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 60000, every = 60) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(every); }
  return fn();
}

fs.rmSync(DATA, { recursive: true, force: true });
fs.mkdirSync(DATA, { recursive: true });

const readLines = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const child = (mode) => new Promise((resolve, reject) => {
  const p = spawn('node', [path.join(HERE, 'restart-child.mjs'), DATA, mode], { cwd: SERVER, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { out += d; });
  p.on('error', reject);
  resolve({ proc: p, getOut: () => out });
});

console.log('\n== BACKEND RESTART: SIGKILL mid-mission, resume from persistence ==');
{
  // phase 1: create + run until item 2 is in flight
  const c1 = await child('create');
  const missionIdFile = path.join(DATA, 'mission-id.txt');
  const created = await waitFor(() => fs.existsSync(missionIdFile), 30000);
  check('child 1 created the mission', created);
  const missionId = created ? fs.readFileSync(missionIdFile, 'utf8').trim() : '(none)';
  console.log(`  mission: ${missionId}`);

  // wait until BOTH items started (item 2's session is now gated = mid-flight)
  const bothStarted = await waitFor(() => {
    const evts = readLines(path.join(DATA, 'events.jsonl'));
    return evts.filter((e) => e.type === 'WORK_STARTED').length >= 2;
  }, 40000);
  check('item 1 finished and item 2 is mid-flight (gated)', bothStarted);

  // REAL kill: SIGKILL — no graceful shutdown, no flush, nothing
  c1.proc.kill('SIGKILL');
  await new Promise((r) => setTimeout(r, 400));
  const killed = c1.proc.killed || c1.proc.exitCode !== null;
  check('child 1 was SIGKILLed (no graceful shutdown)', killed);
  const sessionsRun1 = readLines(path.join(DATA, 'sessions.jsonl')).filter((s) => s.mode === 'create');
  check('process 1 ran item 1 to completion and STARTED item 2 (gated mid-flight)', sessionsRun1.length === 2, `got ${sessionsRun1.length}`);

  // open the gate, boot a FRESH process (only persisted state exists)
  fs.writeFileSync(path.join(DATA, 'gate.done'), 'go');
  const c2 = await child('resume');
  const finalFile = path.join(DATA, 'final.json');
  const finished = await waitFor(() => fs.existsSync(finalFile), 60000);
  check('child 2 resumed and finished the mission', finished);
  const final = finished ? JSON.parse(fs.readFileSync(finalFile, 'utf8')) : {};
  check('mission COMPLETED after the restart', final.state === 'COMPLETED', JSON.stringify(final));

  const allSessions = readLines(path.join(DATA, 'sessions.jsonl'));
  check('item 1 was NEVER re-executed (p2 re-ran ONLY the in-flight item 2: 1 session)', allSessions.filter((s) => s.mode === 'create').length === 2 && allSessions.filter((s) => s.mode === 'resume').length === 1, JSON.stringify(allSessions));

  // the persisted event log (missions/<id>/events.jsonl) is the source of truth —
  // the child's subscriber stream only covers what it was alive for
  const persistedEvts = readLines(path.join(DATA, 'missions', missionId, 'events.jsonl'));
  check('MISSION_RESTART_RECOVERY recorded honestly in the persisted log', persistedEvts.some((e) => e.type === 'MISSION_RESTART_RECOVERY'));
  check('exactly one MISSION_COMPLETED (no phantom double-finish)', persistedEvts.filter((e) => e.type === 'MISSION_COMPLETED').length === 1);
  check('the persisted mission shows 1 restart survived', (() => {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(DATA, 'missions', missionId, 'mission.json'), 'utf8'));
      return m.usage?.restarts === 1;
    } catch { return false; }
  })());
  check('both items DONE in the final record', (() => {
    try {
      const g = JSON.parse(fs.readFileSync(path.join(DATA, 'missions', missionId, 'graph.json'), 'utf8'));
      return g.items.length === 2 && g.items.every((i) => i.status === 'DONE');
    } catch { return false; }
  })());

  if (!finished) { try { c2.proc.kill('SIGKILL'); } catch { /* already gone */ } }
}

console.log('\n============================================================');
console.log(`B211 B4 BACKEND-RESTART: ${pass} passed, ${fail} failed`);
console.log('============================================================');
if (fail > 0) process.exit(1);

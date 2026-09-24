/**
 * JEXI OS — Phase 27 Scope A — LIVE PROBE: detached session fleet.
 *
 * P1 spawn a bg session -> sessionId + pid
 * P2 list -> shows it running
 * P3 logs -> stream returns real output
 * P4 kill -> state 'killed'
 * P5 stale detection: SIGKILL the process externally -> reap marks 'stale'
 * P6 reboot recovery: wipe in-memory, reload from disk -> roster survives
 *    (proven across a REAL separate node process, not just a second instance)
 * P7 errors: E_UNKNOWN_SESSION, E_INVALID_TRANSITION
 * P8 determinism (pid/startedAt/endedAt are OS/time-assigned and normalized;
 *    every deterministic field compared byte-for-byte)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync, execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createFleet } from '../runtime/session/fleet/index.js';

// consolidation cleanup: host-portable scratch base (os.tmpdir()) instead of a
// hardcoded sandbox path; REPO_ROOT anchors the reboot child-script's import.
const BASE = process.env.P27_LOGS || path.join(os.tmpdir(), 'p27-logs');
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FLEET_ENTRY = pathToFileURL(path.join(REPO_ROOT, 'runtime/session/fleet/index.js')).href;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function freshDir(name) {
  const dir = `${BASE}/${name}`;
  fs.rmSync(dir, { recursive: true, force: true });
  return dir;
}

async function readStream(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function waitTerminal(fleet, sessionId, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const record = fleet.roster.get(sessionId);
    if (record.state !== 'running') return record;
    await sleep(20);
  }
  throw new Error(`session "${sessionId}" still running after ${timeoutMs}ms`);
}

function expectCode(fn, code, label) {
  try {
    fn();
  } catch (err) {
    if (err && err.code === code) return err;
    throw new Error(`${label}: expected ${code}, got ${err && err.code ? err.code : String(err)}`);
  }
  throw new Error(`${label}: expected ${code}, but no error was thrown`);
}

async function expectCodeAsync(fn, code, label) {
  try {
    await fn();
  } catch (err) {
    if (err && err.code === code) return err;
    throw new Error(`${label}: expected ${code}, got ${err && err.code ? err.code : String(err)}`);
  }
  throw new Error(`${label}: expected ${code}, but no error was thrown`);
}

const REBOOT_SCRIPT = `
import { createFleet } from '${FLEET_ENTRY}';
const fleet = createFleet({ dir: '__DIR__' });
console.log(JSON.stringify(fleet.list()));
`;

let pass = 0;
let fail = 0;
const results = [];

async function probe(name, fn) {
  try {
    const detail = await fn();
    pass += 1;
    results.push(`P${name}: PASS — ${detail}`);
  } catch (err) {
    fail += 1;
    results.push(`P${name}: FAIL — ${err.message}`);
  }
}

const dir = freshDir('fleet-a');
const fleet = createFleet({ dir });

// -- P1 ---------------------------------------------------------------------
await probe(1, async () => {
  const { sessionId, pid } = fleet.spawn('sleep 5', { id: 'bg-p1' });
  if (!sessionId || !Number.isInteger(pid)) throw new Error(`bad spawn result ${JSON.stringify({ sessionId, pid })}`);
  const record = fleet.roster.get(sessionId);
  if (record.state !== 'running') throw new Error(`expected running right after spawn, got ${record.state}`);
  if (record.pid !== pid) throw new Error(`roster pid ${record.pid} != spawn pid ${pid}`);
  return `spawn("sleep 5") -> sessionId=${sessionId} pid=${pid} (running, roster on disk)`;
});

// -- P2 ---------------------------------------------------------------------
await probe(2, async () => {
  const rows = fleet.list();
  const row = rows.find((r) => r.sessionId === 'bg-p1');
  if (!row) throw new Error('bg-p1 missing from list()');
  if (row.state !== 'running') throw new Error(`expected running, got ${row.state}`);
  const ids = rows.map((r) => r.sessionId);
  if (JSON.stringify(ids) !== JSON.stringify([...ids].sort())) throw new Error('list() not sorted by sessionId');
  return `list() -> ${JSON.stringify(rows)}`;
});

// -- P3 ---------------------------------------------------------------------
await probe(3, async () => {
  fleet.spawn('echo hello-fleet', { id: 'bg-echo' });
  await waitTerminal(fleet, 'bg-echo');
  const out = await readStream(fleet.logs('bg-echo'));
  if (!out.includes('hello-fleet')) throw new Error(`log output missing: ${JSON.stringify(out)}`);
  return `logs("bg-echo") streamed real file-backed output: ${JSON.stringify(out.trim())}`;
});

// -- P4 ---------------------------------------------------------------------
await probe(4, async () => {
  fleet.spawn('sleep 60', { id: 'bg-killme' });
  const result = await fleet.kill('bg-killme');
  if (result.killed !== true || result.state !== 'killed') {
    throw new Error(`expected { killed: true, state: "killed" }, got ${JSON.stringify(result)}`);
  }
  const record = fleet.roster.get('bg-killme');
  if (record.state !== 'killed') throw new Error(`roster state ${record.state}`);
  return `kill("bg-killme") -> ${JSON.stringify(result)} (killRequested precedence held)`;
});

// -- P5 ---------------------------------------------------------------------
await probe(5, async () => {
  const { pid } = fleet.spawn('sleep 5', { id: 'bg-stale' });
  await sleep(60); // let it start
  execSync(`kill -9 ${pid}`); // external SIGKILL: no observed exit outcome
  const transitions = fleet.reap(); // synchronous: runs before any queued exit event
  const record = fleet.roster.get('bg-stale');
  if (record.state !== 'stale') throw new Error(`expected stale after external SIGKILL + reap, got ${record.state}`);
  const viaReap = transitions.find((t) => t.sessionId === 'bg-stale');
  return `external kill -9 ${pid} -> reap() -> ${JSON.stringify(transitions.length ? [viaReap] : 'already stale via signal path')} ; final state=${record.state}`;
});

// -- P6 ---------------------------------------------------------------------
await probe(6, async () => {
  fleet.spawn('echo reboot-proof', { id: 'bg-reboot' });
  fleet.spawn('sleep 60', { id: 'bg-long' });
  await waitTerminal(fleet, 'bg-reboot');
  // (a) second in-process instance: zero in-memory carryover by construction
  const second = createFleet({ dir });
  const listA = second.list();
  // (b) REAL reboot: a fresh node process loads the same roster from disk
  const raw = execFileSync(process.execPath, ['--input-type=module', '-e', REBOOT_SCRIPT.replace('__DIR__', dir)], { encoding: 'utf8' });
  const listB = JSON.parse(raw.trim());
  const a = Object.fromEntries(listA.map((r) => [r.sessionId, r.state]));
  const b = Object.fromEntries(listB.map((r) => [r.sessionId, r.state]));
  if (a['bg-reboot'] !== 'exited' || b['bg-reboot'] !== 'exited') throw new Error(`bg-reboot not exited after reboot: ${JSON.stringify({ a, b })}`);
  if (a['bg-long'] !== 'running' || b['bg-long'] !== 'running') throw new Error(`bg-long not running after reboot: ${JSON.stringify({ a, b })}`);
  await fleet.kill('bg-long'); // cleanup
  return `roster survived restart: separate node process saw ${JSON.stringify(listB.map((r) => `${r.sessionId}:${r.state}`))}`;
});

// -- P7 ---------------------------------------------------------------------
await probe(7, async () => {
  expectCodeAsync(() => fleet.kill('bg-nope'), 'E_UNKNOWN_SESSION', 'kill unknown');
  expectCode(() => fleet.logs('bg-nope'), 'E_UNKNOWN_SESSION', 'logs unknown');
  expectCode(() => fleet.attach('bg-nope'), 'E_UNKNOWN_SESSION', 'attach unknown');
  expectCodeAsync(() => fleet.kill('bg-echo'), 'E_INVALID_TRANSITION', 'kill exited session');
  expectCode(() => fleet.state.transition('bg-echo', 'stale'), 'E_INVALID_TRANSITION', 'backward exited -> stale');
  expectCode(() => fleet.state.transition('bg-killme', 'running'), 'E_INVALID_TRANSITION', 'resurrect killed -> running');
  return 'E_UNKNOWN_SESSION (kill/logs/attach) + E_INVALID_TRANSITION (kill exited; exited->stale; killed->running) all refused';
});

// -- P8 ---------------------------------------------------------------------
await probe(8, async () => {
  const d1 = freshDir('fleet-d1');
  const d2 = freshDir('fleet-d2');
  const f1 = createFleet({ dir: d1 });
  const f2 = createFleet({ dir: d2 });
  const normalize = (records) => records.map(({ pid, startedAt, endedAt, ...rest }) => rest).sort((x, y) => (x.sessionId < y.sessionId ? -1 : 1));

  for (const f of [f1, f2]) {
    f.spawn('echo det-echo', { id: 'bg-det-echo' });
    f.spawn('sleep 60', { id: 'bg-det-kill' });
    await waitTerminal(f, 'bg-det-echo');
    await f.kill('bg-det-kill');
  }
  const n1 = normalize(f1.roster.list());
  const n2 = normalize(f2.roster.list());
  const bytes1 = JSON.stringify(n1, null, 2);
  const bytes2 = JSON.stringify(n2, null, 2);
  if (bytes1 !== bytes2) throw new Error(`rosters differ after normalization:\n${bytes1}\n---\n${bytes2}`);
  const order1 = f1.list().map((r) => r.sessionId);
  const order2 = f2.list().map((r) => r.sessionId);
  if (JSON.stringify(order1) !== JSON.stringify(order2)) throw new Error('list ordering differs');
  return `byte-identical normalized rosters across two independent fleets (${bytes1.length} bytes each); list order ${JSON.stringify(order1)}; pid/startedAt/endedAt normalized (OS/time-assigned)`;
});

for (const line of results) console.log(line);
console.log(`SCOPE A: ${pass}/${pass + fail} PASS, ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);

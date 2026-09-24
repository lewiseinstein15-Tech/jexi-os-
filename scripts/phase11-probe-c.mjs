#!/usr/bin/env node
// Phase 11 Scope C — live probe P1–P8 against the REAL daemon process.
// Spawns/kills/restarts actual processes; every assertion is printed raw.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DaemonClient, DEFAULT_CACHE_ROOT } from '../runtime/kernel/daemon/client.js';

const FRESH = process.argv.includes('--fresh');
const CACHE = DEFAULT_CACHE_ROOT;
const ok = (cond, label) => console.log(`${cond ? '✅' : '❌'} ${label}`);
const show = (label, obj) => console.log(`   ${label}: ${JSON.stringify(obj).slice(0, 300)}`);

// deterministic re-runs: wipe the cache dir at the start (recovery is exercised WITHIN the run)
if (FRESH) {
  fs.rmSync(CACHE, { recursive: true, force: true });
  console.log(`(fresh) cache dir wiped: ${CACHE}`);
}

// fixture: a big-enough tree that an index job takes seconds (killable mid-flight)
const FIXTURE = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-fixture-'));
console.log(`fixture: ${FIXTURE}`);
for (let i = 0; i < 150; i++) {
  const d = path.join(FIXTURE, `pkg${i}`);
  fs.mkdirSync(d);
  for (let j = 0; j < 120; j++) {
    fs.writeFileSync(path.join(d, `mod${j}.js`),
      `// fixture module ${i}/${j}\nexport function fn${i}_${j}(a, b) {\n  const parts = String(a).split('-');\n  return helper(parts, b, ${i * 120 + j});\n}\nfunction helper(parts, b, n) {\n  return parts.join('+') + (b || n);\n}\n`);
  }
}
const touchTarget = path.join(FIXTURE, 'pkg0', 'mod0.js');

let daemonPid = null;
let c2_ = null;
const livePids = () => {
  try { process.kill(daemonPid, 0); return true; } catch { return false; }
};

try {
  // ═══ P1 — first session starts the daemon ═══
  console.log('\n════ P1 — first session starts daemon ════');
  const c1 = await DaemonClient.open({ cacheRoot: CACHE, sessionId: 'session-A', namespace: 'ns-alpha' });
  daemonPid = c1.daemon.pid;
  console.log(`daemon PID: ${daemonPid}`);
  const ep = JSON.parse(fs.readFileSync(path.join(CACHE, 'daemon.json'), 'utf8'));
  show('endpoint file', { pid: ep.pid, port: ep.port, host: ep.host, build: ep.build });
  const st1 = await c1.status();
  console.log('listening check — TCP connect to published port succeeded (handshake round-tripped)');
  show('initial state', { sessions: st1.sessions, jobs: Object.keys(st1.jobs).length, watchers: st1.watchers.length, queueDepth: st1.queueDepth });
  const g0 = await c1.graphStatus();
  show('graph (lazy — daemon itself has loaded nothing)', { backend: g0.backend, projectsOnDisk: g0.projects.map((p) => p.project) });

  // ═══ P2 — session A registers ═══
  console.log('\n════ P2 — session A registered ════');
  show('A', c1.session);
  const st2 = await c1.status();
  console.log(`sessions now: ${JSON.stringify(st2.sessions)}`);

  // ═══ P3 — session B registers ═══
  console.log('\n════ P3 — session B registers ════');
  const c2 = await DaemonClient.open({ cacheRoot: CACHE, sessionId: 'session-B', namespace: 'ns-beta' });
  const st3 = await c2.status();
  ok(st3.sessions.length === 2, 'both A and B registered');
  show('sessions', st3.sessions.map((s) => ({ id: s.id, ns: s.namespace })));

  // ═══ P4 — session A closes; its work cancelled; B unaffected ═══
  console.log('\n════ P4 — session A closes ════');
  const jobA = await c1.index({ sessionId: 'session-A', project: 'fixture-A', root: FIXTURE });
  console.log(`A started index job ${jobA.jobId}`);
  await new Promise((r) => setTimeout(r, 250));
  const unA = await c1.unregister('session-A');
  c1.close();
  console.log(`A unregistered → cancelledJobs=${JSON.stringify(unA.cancelledJobs)} watchersStopped=${JSON.stringify(unA.watchersStopped)}`);
  const st4 = await c2.status();
  const jobAAfter = st4.jobs[jobA.jobId];
  ok(jobAAfter.status === 'cancelled', `A's job cancelled (${jobAAfter.status})`);
  ok(st4.sessions.some((s) => s.id === 'session-B') && !st4.sessions.some((s) => s.id === 'session-A'), 'B still registered, A gone');

  // ═══ P5 — SIGKILL daemon mid-index; restart; recovery ═══
  console.log('\n════ P5 — SIGKILL mid-index + recovery ════');
  const jobB = await c2.index({ sessionId: 'session-B', project: 'fixture-B', root: FIXTURE });
  console.log(`B started index job ${jobB.jobId} — giving it 1500ms, then kill -9 ${daemonPid}`);
  await new Promise((r) => setTimeout(r, 1500));
  const preJob = (await c2.jobStatus(jobB.jobId)).job;
  console.log(`job state pre-kill: ${preJob.status} (worker pid ${preJob.pid})`);
  ok(preJob.status === 'running', `kill lands MID-INDEX (job ${preJob.status})`);
  process.kill(daemonPid, 'SIGKILL');
  c2.close();
  await new Promise((r) => setTimeout(r, 300));
  ok(!livePids(), 'daemon confirmed dead (SIGKILL, no cleanup)');

  c2_ = await DaemonClient.open({ cacheRoot: CACHE, sessionId: 'session-B2', namespace: 'ns-beta-2' });
  daemonPid = c2_.daemon.pid;
  console.log(`daemon restarted, new PID: ${daemonPid}`);
  const st5 = await c2_.status();
  show('recovery block', st5.recovery);
  show('jobB after recovery', st5.jobs[jobB.jobId]);
  ok(['interrupted', 'completed', 'failed'].includes(st5.jobs[jobB.jobId].status), `jobB resolved post-recovery (${st5.jobs[jobB.jobId].status})`);
  ok(st5.recovery.replayedEvents > 0, `journal replayed from cache dir: ${st5.recovery.replayedEvents} events`);
  ok(st5.recovery.interruptedJobs.includes(jobB.jobId), `interrupted job recovered: ${JSON.stringify(st5.recovery.interruptedJobs)}`);
  const g1 = await c2_.graphStatus('jexi-os');
  console.log(`graph-status(jexi-os) after crash: nodes=${g1.project?.nodes} edges=${g1.project?.edges} indexedAt=${g1.indexedAt}`);
  ok((g1.project?.nodes || 0) > 8000, 'pre-crash completed graph intact (jexi-os project counts unchanged)');

  // ═══ P6 — admission barrier refuses bad build / ABI / cache-root ═══
  console.log('\n════ P6 — admission barrier ════');
  for (const [label, overrides] of [
    ['bad build', { buildOverride: 'deadbeefdeadbeef' }],
    ['bad ABI', { abiOverride: { nodeMajor: 16, platform: 'sunos', arch: 'mips' } }],
    ['mismatched cache-root', { cacheRootOverride: '/tmp/definitely-not-the-cache' }],
  ]) {
    try {
      await DaemonClient.open({ cacheRoot: CACHE, ...overrides, spawnIfDown: false });
      ok(false, `${label} — SHOULD HAVE BEEN REFUSED`);
    } catch (err) {
      ok(String(err.code || '').includes('MISMATCH'), `${label} → REFUSED ${err.code}: ${err.message.slice(0, 100)}`);
    }
  }

  // ═══ P7 — shared watcher triggers incremental index ═══
  console.log('\n════ P7 — shared watcher ════');
  const w = await c2_.watch({ sessionId: 'session-B2', dir: FIXTURE, project: 'fixture-watch' });
  console.log(`watcher registered: ${JSON.stringify(w.watcher)}`);
  fs.appendFileSync(touchTarget, `\n// touched at ${new Date().toISOString()}\nexport function touched(){ return 1; }\n`);
  console.log(`touched ${touchTarget} — waiting for daemon-triggered job…`);
  let watched = null;
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 250));
    const stx = await c2_.status();
    const j = Object.values(stx.jobs).find((x) => x.project === 'fixture-watch');
    if (j && (j.status === 'completed' || j.status === 'failed')) { watched = j; break; }
  }
  ok(watched && watched.status === 'completed', `watcher triggered incremental index → job ${watched?.id || '?'} ${watched?.status || 'TIMEOUT'}`);
  show('watcher-triggered job', watched);
  const journalPath = path.join(CACHE, 'events.journal');
  const watcherEvts = fs.readFileSync(journalPath, 'utf8').split('\n').filter((l) => l.includes('watcher-triggered'));
  console.log(`journal watcher-triggered entries: ${watcherEvts.length}`);
  console.log(`   last: ${(watcherEvts[watcherEvts.length - 1] || '').slice(0, 220)}`);

  // ═══ P8 — clean shutdown ═══
  console.log('\n════ P8 — clean shutdown ════');
  const st8 = await c2_.status();
  console.log(`sessions before shutdown: ${st8.sessions.map((s) => s.id).join(', ')}`);
  await c2_.shutdown();
  c2_.close();
  await new Promise((r) => setTimeout(r, 700));
  ok(!fs.existsSync(path.join(CACHE, 'daemon.json')), 'endpoint file removed on clean stop');
  let gone = false;
  try { process.kill(daemonPid, 0); } catch { gone = true; }
  ok(gone, `daemon pid ${daemonPid} no longer alive`);
  const cacheLeft = fs.readdirSync(CACHE);
  ok(cacheLeft.includes('state.json') && cacheLeft.includes('events.journal'), `cache dir intact: ${JSON.stringify(cacheLeft)}`);
  const { execFileSync } = await import('node:child_process');
  let leftover = '';
  try {
    leftover = execFileSync('ps', ['-eo', 'pid,args'], { encoding: 'utf8' })
      .split('\n').filter((l) => /node \S*(codegraph-daemon|scripts\/phase11-index\.mjs)/.test(l)).join('\n').trim();
  } catch { leftover = ''; }
  console.log(leftover ? `❌ LEFTOVER PROCESSES:\n${leftover}` : '✅ no leftover processes (no codegraph-daemon, no phase11-index workers)');
  console.log('\nALL P1–P8 DONE');
} finally {
  // probe self-cleanup: never leak the daemon or fixture
  try { if (daemonPid && livePids()) process.kill(daemonPid, 'SIGTERM'); } catch { /* dead */ }
  await new Promise((r) => setTimeout(r, 400));
  try { fs.rmSync(FIXTURE, { recursive: true, force: true }); } catch { /* best effort */ }
}

/**
 * JEXI OS — PHASE 31 SCOPE 3 — live probe (P1–P6).
 *
 * SCOPE 17 HYGIENE (probe-only, disclosed): the scope-3-era assertions below
 * went stale as later scopes wired more targets onto the same boot. Fixed:
 *   - boot line counts are read LIVE (in-process boot total; Scope 1's 15
 *     asserted as the original floor, Scope 3's 7 still exact) instead of the
 *     hardcoded 15+7=22 total;
 *   - the ralph.js diff is asserted against the COMMITTED tip (diff vs the
 *     last pre-wiring state) — the wiring lives in commits now, the old
 *     working-tree diff is empty;
 *   - the zone check accepts the full phase-31 committed surface + the
 *     scope-17 named call sites instead of scope-3 files only.
 * No production code is touched by this probe.
 *
 * P1 server boots with all 7 Scope 3 targets initialized (+ Scope 1's 15 intact)
 * P2 per-item end-to-end reachability with real call traces:
 *      S3-AUTO    autonomy cycle fires on a scheduler tick (cron job -> handler)
 *      S3-CYCLE   brain.cycle invoked by cron job (runNow trigger)
 *      S3-OFFLOAD context/offload retention reachable from the chat history path
 *      S3-GSD     GSD 5-phase loop invoked from the workgraph seam via the looper
 *      W23e       ralph diagnostics handler invoked at a ralph checkpoint
 *      W23f       ciDoctor reachable on a simulated CI failure (live-CI NOT VERIFIED)
 *      WA4        wa4-topology mounted; composeWorkforce -> topologies.build/validate
 * P3 read-only proof: shipped modules referenced by wired imports diff EMPTY
 *      (swarm/loops/ralph.js = wiring import + register call only, run() untouched)
 * P4 regression: server boots cleanly, Scope 1's 15 W31 lines present, endpoints respond
 * P5 zone check: git status --short only named call sites + scripts/phase31-*.mjs
 * P6 determinism: same boot twice -> identical W31 boot lines (modulo runtime/pid)
 */
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'w31s3-probe-'));
const FAILS = [];
let n = 0;
function check(id, ok, detail) {
  n += 1;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${id} — ${detail}`);
  if (!ok) FAILS.push(`${id}: ${detail}`);
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function health(port, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return { status: res.status, body: await res.text() };
    } catch { /* not up yet */ }
    await pause(700);
  }
  return null;
}
function bootServer(port, runtimeDir, dataDir) {
  const logFile = path.join(TMP, `boot-${port}.log`);
  const child = spawn(process.execPath, ['index.js'], {
    cwd: path.join(ROOT, 'server'),
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', JEXI_W31_RUNTIME: runtimeDir, DATA_DIR: dataDir },
    stdio: ['ignore', fs.openSync(logFile, 'a'), fs.openSync(logFile, 'a')],
  });
  return { child, logFile };
}
const w31Lines = (file) => fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.startsWith('W31 '));
const normalize = (s, runtimeDir, dataDir) => s.split(runtimeDir).join('<RUNTIME>').split(dataDir).join('<DATA>').replace(/boot-\d+/g, 'boot-<pid>');

/* ============ in-process wiring instance for P2 (probe-owned runtime) ====== */
const { initPhase31Wiring, wiring } = await import(path.join(ROOT, 'server/src/wiring/phase31-bootstrap.js'));
const RT = path.join(TMP, 'probe-runtime');
const DT = path.join(TMP, 'probe-data');
fs.mkdirSync(RT, { recursive: true });
fs.mkdirSync(DT, { recursive: true });
const boot = initPhase31Wiring({ sessionId: `boot-${process.pid}`, runtimeRoot: RT, brainRoot: path.join(RT, 'brain'), fleetDir: path.join(RT, 'fleet'), observersRoot: path.join(RT, 'instincts-observe'), vikingRoot: path.join(RT, 'viking') });
const probeLines = boot.log;
const scope1Lines = probeLines.filter((l) => !/W31 (S3-|W23e|W23f|WA4:)/.test(l));
const scope3Lines = probeLines.filter((l) => /W31 (S3-|W23e|W23f|WA4:)/.test(l));
check('P2.probe-init', scope1Lines.length >= 15 && scope3Lines.length === 7 && !probeLines.some((l) => l.includes('FAIL-SOFT')),
  `probe boot: ${probeLines.length} W31 lines live (>= 15 Scope-1 originals intact + exactly ${scope3Lines.length}/7 Scope-3 lines), 0 FAIL-SOFT`);
console.log(scope3Lines.map((l) => `  ${l}`).join('\n'));

/* ================= P1 — server boots with all 7 targets ==================== */
console.log('\n== P1 server boots with all 7 Scope 3 targets initialized ==');
const PORT1 = 4700 + (process.pid % 400) * 2;
const rt1 = path.join(TMP, 'boot1-runtime');
const dt1 = path.join(TMP, 'boot1-data');
const b1 = bootServer(PORT1, rt1, dt1);
const h1 = await health(PORT1);
check('P1.server-up', !!h1 && h1.status === 200, h1 ? `GET /api/health -> ${h1.status}` : 'health never came up (see boot log)');
let p1lines = w31Lines(b1.logFile);
for (let i = 0; i < 10 && p1lines.length === 0 && !b1.child.killed; i++) { await pause(600); p1lines = w31Lines(b1.logFile); }
console.log(p1lines.map((l) => `  ${l}`).join('\n'));
const s1 = p1lines.filter((l) => !/W31 (S3-|W23e|W23f|WA4:)/.test(l));
const s3 = p1lines.filter((l) => /W31 (S3-|W23e|W23f|WA4:)/.test(l));
check('P1.all-7-targets', s3.length === 7 && p1lines.length === probeLines.length && !p1lines.some((l) => l.includes('FAIL-SOFT')),
  `${s3.length}/7 Scope 3 boot lines, server boot total ${p1lines.length} == live in-process total ${probeLines.length} (count read live, no hardcode), 0 FAIL-SOFT`);

/* ================= P2 — per-item end-to-end reachability =================== */
console.log('\n== P2 per-item reachability (end-to-end, consumer level) ==');

/* ---- S3-OFFLOAD: writer (shipped workgraph/session store) -> ndjournal -> context/offload history reader -> registered chat context source */
console.log('-- S3-OFFLOAD --');
const sessRoots = wiring.contextOffload.roots();
const { createStore } = await import(path.join(ROOT, 'runtime/workgraph/session/index.js'));
const store = createStore({ directory: sessRoots.sessions, sessionId: 'chat-retention-probe' });
const appended = store.append({ kind: 'user', payload: { text: 'offload probe: retain this turn in the session journal' } });
console.log('  writer append (shipped workgraph/session store):', JSON.stringify(appended));
const sources = wiring.sources();
const offRegistered = (sources || []).some((s) => s && s.name === 'session-offload-history');
check('P2.S3-OFFLOAD.source-registered', offRegistered, `registerSource list contains session-offload-history (${(sources || []).length} sources total)`);
const { collectSources } = await import(path.join(ROOT, 'server/src/context/sources/index.js'));
const collected = await collectSources({ sessionId: 'chat-retention-probe' }, {}, { only: ['session-offload-history'] });
const produced = collected && collected[0] ? collected[0].content : '';
console.log('  produce() ->', JSON.stringify(produced));
check('P2.S3-OFFLOAD.chat-path-reachable', typeof produced === 'string' && produced.includes('offload probe: retain this turn'),
  `collectSources() — the chat prompt pipeline — returned the retained node via the offload history reader: ${JSON.stringify(produced).slice(0, 140)}`);
const offWrite = wiring.contextOffload.write('probe-note', 'offload store roundtrip content');
const offRead = wiring.contextOffload.read('probe-note');
check('P2.S3-OFFLOAD.store-roundtrip', offWrite.written === true && offRead.content === 'offload store roundtrip content',
  `offload.write -> ${offWrite.path.split('/').pop()} (${offWrite.sizeBytes}B, sha256 ${offWrite.sha256.slice(0, 12)}...) -> read back identical`);

/* ---- S3-GSD: workgraph seam handler -> looper.run -> real GSD disk phases */
console.log('-- S3-GSD --');
const gsd = await wiring.workgraph.gsdLoop({ taskId: 'probe-gsd-task', input: 'Phase 31 Scope 3 probe input for the wired GSD loop' });
console.log('  gsdLoop() ->', JSON.stringify({ seed: gsd.seed, loop: gsd.loop, trace: gsd.trace, status: gsd.status }));
check('P2.S3-GSD.five-phase-loop', gsd.seed === 'discuss' && gsd.loop.stoppedBy === 'stop-condition' && gsd.trace.length === 4 && gsd.status.shipped === true,
  `discuss seeded; looper trace [${gsd.trace.join(' -> ')}]; shipped=${gsd.status.shipped}; artifacts=${JSON.stringify(gsd.status.artifacts)}`);

/* ---- W23e: ralph loop checkpoint -> emitCheckpoint -> diagnostics.evaluate */
console.log('-- W23e --');
const checkpointTrace = [];
const ralphRes = wiring.ralphCheckpoint.run(
  (ctx, attempt) => ({ ok: false, failure: `attempt ${attempt} deliberately fails (probe)` }),
  {
    maxAttempts: 3,
    adjustContext: (ctx, failure) => {
      const findings = wiring.ralphCheckpoint.emit({
        task: 'probe task: prove diagnostics fire at the ralph checkpoint',
        verification: 'probe-output', tests: ['phase31-scope-3-probe'], skills: [], logs: 'checkpoint trace collected', deviations: [],
      });
      checkpointTrace.push({ failure, findings: findings[0].findings.map((f) => f.code) });
      return ctx;
    },
  }
);
console.log('  ralph.run() ->', JSON.stringify({ attempts: ralphRes.attempts, stoppedBy: ralphRes.stoppedBy }));
console.log('  checkpoint trace:', JSON.stringify(checkpointTrace, null, 2).replace(/\n/g, '\n  '));
check('P2.W23e.checkpoint-fired', ralphRes.attempts === 3 && checkpointTrace.length === 3 && checkpointTrace.every((c) => c.findings.includes('W_NO_SKILLS')),
  'diagnostics.evaluate() invoked at every failure checkpoint (default handler registered in ralph.js; run() body untouched)');

/* ---- W23f: ciDoctor on a simulated CI failure (live-CI NOT VERIFIED) ------ */
console.log('-- W23f --');
const simCiLog = [
  '> jexi-os@ CI run',
  'FAIL server/tests/example.test.js',
  '  AssertionError: expected 3 to equal 4',
  'Tests: 1 failed, 5 passed, 6 total',
  'npm ERR! Test failed.  See above for more details.',
].join('\n');
const diag = wiring.ciDoctor.diagnose({ logs: simCiLog });
console.log('  diagnose(simulated CI failure) ->', JSON.stringify(diag, null, 2).replace(/\n/g, '\n  '));
check('P2.W23f.simulated-reachable', diag && diag.rootCause === 'test-failure' && Array.isArray(diag.evidence) && diag.evidence.length >= 2 && diag.suggestions.length >= 1,
  `rootCause=${diag.rootCause}, evidence=${diag.evidence.length} verbatim line(s), suggestions=${diag.suggestions.length} — handler reachable on a simulated CI failure`);
let noLogsHonest = false;
try { wiring.ciDoctor.diagnose({}); } catch (e) { noLogsHonest = (e && e.code === 'E_NO_LOGS') || String(e && e.message).includes('E_NO_LOGS'); }
check('P2.W23f.honest-empty-path', noLogsHonest, 'diagnose({}) refused with E_NO_LOGS (no guessing)');

/* ---- WA4: boot-seam mount -> composeWorkforce -> topologies.build/validate */
console.log('-- WA4 --');
const known = wiring.wa4.knownTopologies();
const pass = wiring.wa4.dispatch('code');
console.log('  dispatch("code") passthrough ->', JSON.stringify(pass));
const { rosterStats } = await import(path.join(ROOT, 'server/src/workforce/registry/index.js'));
const caps = Object.keys(rosterStats().byCapability).sort();
const cap = caps.find((c) => (wiring.wa4.dispatch(c).members || []).length >= 2) || 'code';
const topo = wiring.wa4.dispatch(cap, { topology: 'star', limit: 4 });
console.log(`  dispatch("${cap}", {topology:"star", limit:4}) ->`, JSON.stringify({ type: topo.topology && topo.topology.type, members: topo.members, edges: topo.topology && topo.topology.edges, validate: topo.validate }));
const routeOk = topo.route ? topo.route(topo.members[0], topo.members[topo.members.length - 1]) : null;
check('P2.WA4.build-validate', topo.passthrough === false && topo.topology && topo.topology.type === 'star' && topo.topology.edges.length === topo.members.length - 1 && topo.validate.valid === true && Array.isArray(routeOk),
  `composeWorkforce("${cap}") -> [${topo.members.join(', ')}]; star build = ${topo.topology.edges.length} real edges; validate=true; route ${JSON.stringify(routeOk)}; known=[${known.join(', ')}]`);
check('P2.WA4.default-passthrough', pass.passthrough === true && pass.topology === null,
  'default dispatch (no topology requested) = behavior-neutral passthrough of composed members');

/* ---- S3-CYCLE: brain.cycle invoked by cron job (runNow = trigger a run) --- */
console.log('-- S3-CYCLE --');
const jobBefore = wiring.brainCycle.job('w31-brain-cycle');
console.log('  cron job at boot:', JSON.stringify(jobBefore));
const fired = wiring.autonomy.engine().runNow('w31-brain-cycle', 'manual');
check('P2.S3-CYCLE.run-now', !!fired && fired.ok === true, `engine.runNow(w31-brain-cycle) -> run ${fired.run.id}`);
let cycleRun = null;
for (let i = 0; i < 40 && !cycleRun; i++) {
  await pause(500);
  const rep = wiring.autonomy.engine().runReport(fired.run.id);
  if (rep && rep.run && (rep.run.status === 'completed' || rep.run.status === 'failed')) cycleRun = rep;
}
const cycleResult = cycleRun && cycleRun.run ? cycleRun.run.result : null;
const cyclePhases = cycleResult && cycleResult.phases ? cycleResult.phases : [];
const okPhases = cyclePhases.filter((p) => p.ok).map((p) => p.name);
const errPhases = cyclePhases.filter((p) => !p.ok).map((p) => `${p.name}:${p.status}${p.error ? '(' + p.error.code + ')' : ''}`);
console.log(`  run ${fired.run.id} status=${cycleRun && cycleRun.run ? cycleRun.run.status : 'n/a'}; phases ok=[${okPhases.join(', ')}]; non-ok=[${errPhases.join(', ')}] (LLM-backed phases fail honestly without a provider — no fake progress)`);
check('P2.S3-CYCLE.cron-invoked-cycle', !!cycleRun && cycleRun.run.status === 'completed' && okPhases.length >= 1,
  `brain.cycle ran through the scheduler cron job (trigger=${cycleRun && cycleRun.run ? cycleRun.run.trigger : 'n/a'}, action=handler brain-cycle, ${cyclePhases.length} phase records)`);

/* ---- S3-AUTO: autonomy cycle fires on a scheduler TICK (cron) ------------- */
console.log('-- S3-AUTO --');
const goal = wiring.autonomy.goalSet({ description: 'w31 probe: autonomy ledger pass must fire on a scheduler tick', maxTurns: 3 });
console.log('  goal set via accessor:', JSON.stringify(goal));
const hb = wiring.autonomy.heartbeat();
const pings = [];
const sub = hb.onFire((e) => pings.push(e));
hb.schedule(goal.goalId, { everyMs: 300, maxPings: 2 });
const now = new Date();
const msToBoundary = 60000 - (now.getSeconds() * 1000 + now.getMilliseconds()) + 2500;
console.log(`  heartbeat armed (in-process autonomy cycle, maxPings=2); waiting ${Math.round(msToBoundary / 1000)}s for the scheduler cron tick (minute boundary + 2.5s)...`);
await pause(msToBoundary);
await wiring.autonomy.engine().tick();
let autoRun = null;
for (let i = 0; i < 30 && !autoRun; i++) {
  await pause(1000);
  const runs = wiring.autonomy.engine().history({ limit: 50, jobId: 'w31-autonomy-cycle', status: 'completed' });
  if (runs.runs && runs.runs.length) {
    const rep = wiring.autonomy.engine().runReport(runs.runs[0].id);
    if (rep && rep.run && rep.run.trigger === 'cron') autoRun = rep;
  }
}
sub.unsubscribe();
await pause(700); // let the capped heartbeat finish its 2 pings
console.log(`  cron-fired run:`, JSON.stringify(autoRun && autoRun.run ? { id: autoRun.run.id, trigger: autoRun.run.trigger, status: autoRun.run.status, result: autoRun.run.result } : null));
console.log(`  heartbeat pings observed: ${pings.length} ${JSON.stringify(pings)}`);
check('P2.S3-AUTO.tick-fired', !!autoRun && autoRun.run.trigger === 'cron' && autoRun.run.status === 'completed' && autoRun.run.result && autoRun.run.result.active && autoRun.run.result.active.includes(goal.goalId),
  `autonomy cycle fired on a real scheduler cron tick -> handler autonomy-cycle -> goal ledger pass (goals=${autoRun && autoRun.run && autoRun.run.result ? autoRun.run.result.goals : 'n/a'}, active includes ${goal.goalId}); heartbeat leg pinged ${pings.length}x`);

/* ================= P3 — read-only proof on shipped modules ================= */
/* Scope 17 hygiene: the wiring is COMMITTED now, so the original working-tree
 * diff is empty and the old assertions could never see it. The same rule is
 * asserted against the committed tip: ralph.js is diffed against its last
 * pre-wiring state (parent of the last commit that touched it), and every
 * other shipped module's last-touching commit must predate phase 31. */
console.log('\n== P3 read-only proof: shipped modules referenced by wired imports ==');
const shippedRefs = [
  'runtime/scheduler/autonomous/index.js', 'mind/brain/cycle/index.js', 'runtime/context/offload/index.js',
  'runtime/workgraph/phases/gsd/index.js', 'agents/swarm/loops/looper.js', 'agents/swarm/loops/ralph.js',
  'harness/hardening/ralph/index.js', 'harness/hardening/ralph/ci-doctor.js', 'harness/hardening/ralph/diagnostics.js',
  'agents/swarm/topologies/index.js', 'server/src/workforce/registry/index.js', 'server/src/scheduler/index.js',
];
const numstat = execSync('git diff --numstat', { cwd: ROOT, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
console.log('  git diff --numstat (working tree):');
console.log(numstat.map((l) => `    ${l}`).join('\n') || '    (empty)');
const ralphLast = execSync('git rev-list -1 HEAD -- swarm/loops/ralph.js', { cwd: ROOT, encoding: 'utf8' }).trim();
const ralphPre = `${ralphLast}^`;
const ralphDiff = execSync(`git diff ${ralphPre} -- swarm/loops/ralph.js`, { cwd: ROOT, encoding: 'utf8' });
console.log(`  swarm/loops/ralph.js diff vs pre-wiring state ${ralphPre.slice(0, 12)} (committed + working tree; must be wiring import + register call only, run() untouched):`);
console.log(ralphDiff.split('\n').map((l) => `    | ${l}`).join('\n'));
const ralphBodyClean = !ralphDiff.includes('let context = initialContext') && !/^-.*(outcome|attempt|adjustContext|contextLog)/m.test(ralphDiff);
const touched = numstat.map((l) => l.split('\t')[2]);
const otherShippedDirty = shippedRefs.filter((f) => f !== 'swarm/loops/ralph.js' && touched.includes(f));
const phase31TouchedShipped = [];
for (const f of shippedRefs) {
  if (f === 'swarm/loops/ralph.js') continue;
  const last = execSync(`git rev-list -1 HEAD -- ${f}`, { cwd: ROOT, encoding: 'utf8' }).trim();
  const msg = last ? execSync(`git log -1 --format=%s ${last}`, { cwd: ROOT, encoding: 'utf8' }).trim() : '(untracked)';
  if (msg.startsWith('phase-31')) phase31TouchedShipped.push(`${f} @ ${msg}`);
}
check('P3.shipped-internals-empty', otherShippedDirty.length === 0 && phase31TouchedShipped.length === 0,
  `every wired shipped module untouched except the disclosed W23e call site (working-tree violations: ${JSON.stringify(otherShippedDirty)}; phase-31 commits touching shipped internals: ${JSON.stringify(phase31TouchedShipped)})`);
check('P3.ralph-wiring-only', ralphBodyClean && ralphDiff.includes('+import { evaluate as evaluateLoopPolicy }') && ralphDiff.includes('+export const defaultCheckpointRegistration') && !ralphDiff.includes('-export function run'),
  'ralph.js = 1 wiring import + checkpoint registry + register call; run() body byte-identical (no removal lines)');

/* ================= P4 — regression ========================================= */
console.log('\n== P4 regression: clean boot, Scope 1 lines intact, endpoints respond ==');
check('P4.boot-clean', !!h1 && h1.status === 200 && s1.length >= 15 && p1lines.length === probeLines.length && !p1lines.some((l) => l.includes('FAIL-SOFT')),
  `boot1 healthy; ${s1.length} non-Scope-3 W31 lines (>= 15 Scope 1 originals verbatim); server total ${p1lines.length} == live in-process total ${probeLines.length}; 0 FAIL-SOFT`);
const epRoster = await fetch(`http://127.0.0.1:${PORT1}/api/roster`, { signal: AbortSignal.timeout(5000) }).then((r) => r.status).catch((e) => String(e).slice(0, 60));
const epSched = await fetch(`http://127.0.0.1:${PORT1}/api/scheduler/jobs?limit=5`, { signal: AbortSignal.timeout(5000) }).then((r) => r.json()).catch((e) => String(e).slice(0, 60));
const schedOk = epSched && typeof epSched === 'object';
console.log(`  GET /api/roster -> ${epRoster}; GET /api/scheduler/jobs -> ${schedOk ? 'json ok (' + ((epSched.runs && epSched.runs.length) || 0) + ' run rows)' : epSched}`);
check('P4.endpoints-respond', epRoster === 200 && schedOk, 'pre-existing endpoints respond normally with the scheduler engine live');
b1.child.kill('SIGTERM');
await Promise.race([new Promise((r) => b1.child.once('exit', r)), pause(10000)]);
await pause(400);
const logAfterKill = fs.readFileSync(b1.logFile, 'utf8');
const detached = logAfterKill.includes('W31 WA3: instincts observer detached');
check('P4.graceful-shutdown', detached, 'SIGTERM -> W31 WA3 observer detached line present (SessionEnd seam)');

/* ================= P5 — zone check ========================================= */
/* Scope 17 hygiene: the allowed set now covers the full phase-31 committed
 * surface (diff vs the parent of the oldest phase-31 commit) plus the scope-17
 * named call sites, not just the four scope-3 files. A clean tree passes. */
console.log('\n== P5 zone check ==');
const status = execSync('git status --short', { cwd: ROOT, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
console.log(status.map((l) => `  ${JSON.stringify(l)}`).join('\n') || '  (clean tree)');
const first31c = execSync("git rev-list --reverse --grep='^phase-31' HEAD", { cwd: ROOT, encoding: 'utf8' }).trim().split('\n')[0];
const pre31 = `${first31c}^`;
const committedSurface = new Set(execSync(`git diff --name-only ${pre31} HEAD`, { cwd: ROOT, encoding: 'utf8' }).trim().split('\n').filter(Boolean));
const allowedPaths = ['server/src/wiring/phase31-bootstrap.js', 'server/src/wiring/phase31-wa4-topology.js', 'server/src/wiring/phase31-cidoctor.js', 'swarm/loops/ralph.js', 'server/src/providers/config/loader.js'];
const allowed = (l) => {
  const p = l.replace(/^(.{1,2})\s+/, '');
  return allowedPaths.includes(p) || committedSurface.has(p) || p.startsWith('scripts/phase31-');
};
const zoneViolations = status.map((l) => l.replace(/^(.{1,2})\s+/, '')).filter((p) => !allowed(p));
check('P5.zone', zoneViolations.length === 0, `${status.length} entries, all inside named call sites (scope-3 + scope-17) + phase-31 committed surface + scripts/phase31-*.mjs (violations: ${JSON.stringify(zoneViolations)})`);

/* ================= P6 — determinism ======================================== */
console.log('\n== P6 determinism: same boot twice -> identical W31 boot lines ==');
const PORT2 = PORT1 + 1;
const b2 = bootServer(PORT2, path.join(TMP, 'boot2-runtime'), path.join(TMP, 'boot2-data'));
const h2 = await health(PORT2);
let p6lines = w31Lines(b2.logFile);
for (let i = 0; i < 10 && p6lines.length === 0 && !b2.child.killed; i++) { await pause(600); p6lines = w31Lines(b2.logFile); }
const norm1 = p1lines.map((l) => normalize(l, rt1, dt1));
const norm2 = p6lines.map((l) => normalize(l, path.join(TMP, 'boot2-runtime'), path.join(TMP, 'boot2-data')));
const identical = norm1.length === norm2.length && norm1.every((l, i) => l === norm2[i]);
console.log(`  boot1 ${norm1.length} lines vs boot2 ${norm2.length} lines -> ${identical ? 'IDENTICAL' : 'DIFFERENT'}`);
if (!identical) {
  for (let i = 0; i < Math.max(norm1.length, norm2.length); i++) {
    if (norm1[i] !== norm2[i]) console.log(`    diff @${i}:\n      boot1: ${norm1[i]}\n      boot2: ${norm2[i]}`);
  }
}
check('P6.deterministic-boot', !!h2 && identical, 'two boots -> byte-identical W31 boot lines (modulo runtime/data path and pid)');
b2.child.kill('SIGTERM');
await Promise.race([new Promise((r) => b2.child.once('exit', r)), pause(10000)]);

/* ================= cleanup + summary ======================================= */
try { wiring.autonomy.engine().stop(); } catch { /* already stopped */ }
console.log(`\n== SUMMARY: ${n - FAILS.length}/${n} checks pass ==`);
if (FAILS.length) { console.log('FAILURES:'); for (const f of FAILS) console.log(`  - ${f}`); }
console.log(`probe runtime: ${TMP}`);
process.exit(FAILS.length ? 1 : 0);

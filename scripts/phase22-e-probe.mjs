#!/usr/bin/env node
/**
 * JEXI OS — Phase 22 Scope E — LIVE PROBES P1–P7 (GSD 5-phase loop).
 *
 * Raw output only. Every phase that must run with a fresh context runs in a
 * real child node process, so "no shared memory between phases" is demonstrated
 * rather than asserted. P5 SIGKILLs a child between phases and restarts.
 *
 * Usage:
 *   node scripts/phase22-e-probe.mjs
 *   node scripts/phase22-e-probe.mjs --child <mode> <taskId> <root> [phase] [input]
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PROBE = fileURLToPath(import.meta.url);
const REPO = path.resolve(path.dirname(PROBE), '..');
const GSD_MODULE = path.join(REPO, 'runtime/workgraph/phases/gsd/index.js');

/* ───────────────────────── child mode ───────────────────────── */

async function childMain(mode, taskId, root, phaseArg, input) {
  const { Gsd } = await import(GSD_MODULE);
  const g = new Gsd({ root });
  const emit = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);
  const opts = {};
  if (input) opts.input = input;
  if (phaseArg) opts.phase = phaseArg;

  try {
    if (mode === 'status') {
      emit({ ok: true, pid: process.pid, status: g.status(taskId) });
    } else if (mode === 'run') {
      emit({ ok: true, pid: process.pid, result: g.run(taskId, opts) });
    } else if (mode === 'step') {
      emit({ ok: true, pid: process.pid, result: g.step(taskId, opts) });
    } else if (mode === 'step-sleep') {
      // Step once, report, then block so the parent can SIGKILL us mid-flight.
      const r = g.step(taskId, opts);
      emit({ ok: true, pid: process.pid, result: r });
      setInterval(() => {}, 1e9);
      return;
    } else {
      throw new Error(`unknown child mode ${mode}`);
    }
  } catch (err) {
    emit({ ok: false, pid: process.pid, code: err.code ?? null, name: err.name, message: err.message });
  }
}

if (process.argv[2] === '--child') {
  const [, , , mode, taskId, root, phaseArg = '', input = ''] = process.argv;
  await childMain(mode, taskId, root, phaseArg || undefined, input || undefined);
  if (mode !== 'step-sleep') process.exit(0);
}

/* ───────────────────────── parent helpers ───────────────────────── */

const results = {};
const pass = (id, note) => { results[id] = `PASS${note ? ` — ${note}` : ''}`; };
const fail = (id, note) => { results[id] = `FAIL — ${note}`; };
const header = (id, title) => {
  console.log('\n═══════════════════════════════════════════════════');
  console.log(`${id} — ${title}`);
  console.log('═══════════════════════════════════════════════════');
};
const sha = (s) => (s === null ? 'MISSING' : createHash('sha256').update(String(s)).digest('hex'));
const readIf = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
const showFile = (p) => {
  const t = readIf(p);
  console.log(`$ cat ${p}`);
  console.log(t === null ? '(missing)' : t.replace(/\n$/, ''));
};
const J = (v) => JSON.stringify(v ?? null);

/** Spawn a real child process running one GSD operation. */
function runChild(mode, taskId, root, { phase, input, killOnLine } = {}) {
  return new Promise((resolve, reject) => {
    const args = [PROBE, '--child', mode, taskId, root, phase ?? '', input ?? ''];
    const c = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = ''; let line = null;

    c.stdout.on('data', (d) => {
      stdout += d.toString();
      if (killOnLine && line === null && stdout.includes('\n')) {
        try { line = JSON.parse(stdout.slice(0, stdout.indexOf('\n'))); } catch { /* keep null */ }
        c.kill('SIGKILL');
      }
    });
    c.stderr.on('data', (d) => { stderr += d.toString(); });
    c.on('error', reject);
    c.on('close', (code, signal) => {
      if (line === null && stdout.trim()) {
        try { line = JSON.parse(stdout.trim().split('\n').pop()); } catch { /* keep null */ }
      }
      resolve({ line, stderr, code, signal, pid: c.pid });
    });
  });
}

/**
 * Run a child and turn a reported error envelope into a thrown error, so
 * expected-failure assertions read the same as in-process calls.
 */
async function childOrThrow(promise) {
  const r = await promise;
  if (!r.line?.ok) {
    throw Object.assign(new Error(r.line?.message ?? 'child failed'), { code: r.line?.code ?? null });
  }
  return r;
}

/** Capture an expected error from a plain in-process call. */
async function expectError(fn) {
  try { await fn(); return null; } catch (err) { return { code: err.code, name: err.name, message: err.message }; }
}

/** Setup a task through `discuss` in a fresh child. */
const discussIn = (taskId, root, input) => runChild('run', taskId, root, { phase: 'discuss', input });
/** Advance one phase in a fresh child. */
const stepIn = (taskId, root, opts = {}) => runChild('step', taskId, root, opts);
/** Read status in a fresh child. */
const statusIn = (taskId, root) => runChild('status', taskId, root);

/* ───────────────────────── probes ───────────────────────── */

const ROOT = path.join('/tmp', `phase22e-probe-${process.pid}`);
const FILES = ['CONTEXT.md', 'PLAN.md', 'SUMMARY.md', 'UAT.md', 'SHIPPED'];

async function P1() {
  header('P1', "run discuss -> artifact on disk; status shows phase 'discuss'");
  fs.rmSync(ROOT, { recursive: true, force: true });

  const r = await runChild('run', 'p1', ROOT, { phase: 'discuss', input: 'ship a widget; record metrics; expose status' });
  console.log(`discuss child pid: ${r.pid}  exit: ${r.code}`);
  console.log(`run(taskId, {phase:'discuss'}) -> ${J(r.line.result)}`);

  const p = path.join(ROOT, 'p1', 'CONTEXT.md');
  console.log(`artifact path: ${p}`);
  console.log(`exists on disk: ${fs.existsSync(p)}`);
  showFile(p);

  const st = await statusIn('p1', ROOT);
  console.log(`status() from a fresh process -> ${J(st.line.status)}`);

  const ok = fs.existsSync(p) && st.line.status.phase === 'discuss'
    && st.line.status.nextPhase === 'plan';
  (ok ? pass : fail)('P1', ok
    ? "CONTEXT.md on disk; status phase='discuss', nextPhase='plan'"
    : 'artifact missing or status wrong');
}

async function P2() {
  header('P2', 'plan in a FRESH child process reads CONTEXT.md from disk');
  await discussIn('p2', ROOT, 'alpha; beta; gamma');

  // Separate process: no shared memory with the discuss run above.
  const child = await stepIn('p2', ROOT);
  console.log(`plan child pid ${child.pid}  (parent pid ${process.pid}) — different process`);
  console.log(`step() -> ${J(child.line.result)}`);

  const planPath = path.join(ROOT, 'p2', 'PLAN.md');
  showFile(planPath);

  const planText = readIf(planPath) ?? '';
  const refs = planText.includes('consumes: [CONTEXT.md]') && planText.includes('Derived from CONTEXT.md');
  console.log(`plan declares CONTEXT.md as its input: ${refs}`);
  console.log(`plan carries the discuss decisions: ${planText.includes('decisions: D-01, D-02, D-03')}`);

  // Falsification: deleting CONTEXT.md and explicitly asking for plan must
  // refuse. (Asking for no phase instead re-derives from disk and re-runs
  // discuss — that self-healing is covered in P5.)
  const ctxPath = path.join(ROOT, 'p2', 'CONTEXT.md');
  const savedCtx = readIf(ctxPath);
  fs.rmSync(ctxPath);
  const gone = await expectError(() => childOrThrow(stepIn('p2', ROOT, { phase: 'plan' })));
  fs.writeFileSync(ctxPath, savedCtx);
  console.log(`CONTEXT.md deleted, step({phase:'plan'}) -> ${J(gone)}`);

  const ok = child.line.ok && refs && gone?.code === 'E_OUT_OF_ORDER';
  (ok ? pass : fail)('P2', ok
    ? 'plan ran in a separate process, read CONTEXT.md, refuses when absent'
    : 'plan did not depend on the discuss artifact');
}

async function P3() {
  header('P3', 'execute reads PLAN.md only (not CONTEXT.md)');
  await discussIn('p3', ROOT, 'one; two');
  await stepIn('p3', ROOT); // plan

  const child = await stepIn('p3', ROOT); // execute
  console.log(`execute child pid ${child.pid}`);
  console.log(`step() -> ${J(child.line.result)}`);

  const sumPath = path.join(ROOT, 'p3', 'SUMMARY.md');
  showFile(sumPath);

  const sumText = readIf(sumPath) ?? '';
  console.log(`summary declares consumes: [PLAN.md]: ${sumText.includes('consumes: [PLAN.md]')}`);
  console.log(`summary mentions CONTEXT.md (must be false): ${sumText.includes('CONTEXT.md')}`);

  // Falsification on a task that has reached only 'plan', so ship cannot
  // short-circuit the call before execute is reached.
  await discussIn('p3b', ROOT, 'x; y');
  await stepIn('p3b', ROOT); // plan
  const planB = path.join(ROOT, 'p3b', 'PLAN.md');
  const savedPlan = readIf(planB);
  fs.rmSync(planB);
  const gone = await expectError(() => childOrThrow(stepIn('p3b', ROOT, { phase: 'execute' })));
  fs.writeFileSync(planB, savedPlan);
  console.log(`PLAN.md deleted, step({phase:'execute'}) on p3b -> ${J(gone)}`);

  const ok = sumText.includes('consumes: [PLAN.md]') && !sumText.includes('CONTEXT.md')
    && gone?.code === 'E_OUT_OF_ORDER';
  (ok ? pass : fail)('P3', ok
    ? 'execute consumes PLAN.md alone; refuses when it is absent'
    : 'execute consulted something other than PLAN.md');
}

async function P4() {
  header('P4', 'verify + ship -> full loop completes');
  await discussIn('p4', ROOT, 'first; second; third');
  const pl = await stepIn('p4', ROOT);
  const ex = await stepIn('p4', ROOT);
  const vf = await stepIn('p4', ROOT);
  const sh = await stepIn('p4', ROOT);
  console.log(`plan    -> ${J(pl.line.result.phase)}  artifacts ${J(pl.line.result.artifacts)}`);
  console.log(`execute -> ${J(ex.line.result.phase)}`);
  console.log(`verify  -> ${J(vf.line.result.phase)}`);
  console.log(`ship    -> ${J(sh.line.result.phase)}  nextPhase ${J(sh.line.result.nextPhase)}`);

  const st = await statusIn('p4', ROOT);
  console.log(`status() -> ${J(st.line.status)}`);
  console.log('files on disk:', fs.readdirSync(path.join(ROOT, 'p4')).sort());

  const ok = st.line.status.phase === 'ship' && st.line.status.shipped === true
    && FILES.every((f) => st.line.status.artifacts.includes(f));
  (ok ? pass : fail)('P4', ok ? "loop reached 'ship'; all 5 artifacts present" : 'loop did not complete');
}

async function P5() {
  header('P5', 'SIGKILL between phases -> restart resumes from disk');

  // ── part 1: kill after a phase commits; a fresh process resumes ──────────
  await discussIn('p5', ROOT, 'survive; resume');

  const before = await statusIn('p5', ROOT);
  console.log(`before kill, status -> ${J(before.line.status)}`);

  const doomed = await runChild('step-sleep', 'p5', ROOT, { killOnLine: true });
  console.log(`victim pid ${doomed.pid}  reported phase ${J(doomed.line?.result?.phase)}`);
  console.log(`victim terminated by signal: ${doomed.signal}  exit code: ${doomed.code}`);
  console.log('files on disk after SIGKILL:', fs.readdirSync(path.join(ROOT, 'p5')).sort());

  const restart = await statusIn('p5', ROOT);
  console.log(`restart pid ${restart.pid} (fresh process)`);
  console.log(`restart status() -> ${J(restart.line.status)}`);
  console.log(`restart nextPhase, derived from disk -> ${J(restart.line.status.nextPhase)}`);

  const fin = await stepIn('p5', ROOT);
  console.log(`restart step() -> phase ${J(fin.line.result.phase)}, artifacts ${J(fin.line.result.artifacts)}`);

  // ── part 2: the disk is authoritative, not memory ───────────────────────
  // Delete an artifact; a fresh process must re-queue that phase rather than
  // trust that it finished.
  const planPath = path.join(ROOT, 'p5', 'PLAN.md');
  const saved = readIf(planPath);
  fs.rmSync(planPath);
  const after = await statusIn('p5', ROOT);
  console.log(`after deleting PLAN.md, nextPhase -> ${J(after.line.status.nextPhase)}`);
  fs.writeFileSync(planPath, saved);

  // ── part 3: kill DURING the write; the artifact must never be partial ───
  // A large input widens the write window so the kill reliably lands inside
  // it. We poll for the temp file and kill the instant it exists, which is
  // exactly the window where a naive in-place write would leave truncation.
  // Ground truth is an uninterrupted plan step on the same input.
  const bigInput = Array.from({ length: 1200 }, (_, i) => `decision number ${i} about widgets`).join('; ');
  const truthRoot = path.join(ROOT, 'p5truth');
  await discussIn('t', truthRoot, bigInput);
  await stepIn('t', truthRoot);
  const truth = readIf(path.join(truthRoot, 't', 'PLAN.md'));
  console.log(`ground-truth PLAN.md bytes: ${truth?.length}`);

  let sawTmp = 0; let kills = 0; let partial = 0; let completeCount = 0; let absent = 0; let leftoverTmp = 0;
  const TRIALS = 20;
  for (let i = 0; i < TRIALS; i += 1) {
    const dir = path.join(ROOT, `p5atomic${i}`);
    await discussIn('t', dir, bigInput);
    const taskDir = path.join(dir, 't');

    await new Promise((resolve) => {
      const c = spawn(process.execPath, [PROBE, '--child', 'step', 't', dir], { stdio: ['ignore', 'pipe', 'ignore'] });
      let done = false;
      let iv = null;
      let sweep = null;
      const finish = () => {
        if (done) return;
        done = true;
        if (iv) clearInterval(iv);
        if (sweep) clearTimeout(sweep);
        resolve();
      };
      // 0ms poll: fire the kill as soon as the temp file surfaces; a timed
      // fallback fires too, so a kill lands inside the write window regardless
      // of how quickly the loop notices the temp file.
      iv = setInterval(() => {
        let names = [];
        try { names = fs.readdirSync(taskDir); } catch { /* not created yet */ }
        if (names.some((f) => f.includes('.tmp-'))) {
          sawTmp += 1;
          c.kill('SIGKILL');
          finish();
        }
      }, 0);
      sweep = setTimeout(() => { c.kill('SIGKILL'); finish(); }, 6 + i * 2.5);
      c.on('close', (code, signal) => { if (signal === 'SIGKILL') kills += 1; finish(); });
    });

    const got = readIf(path.join(taskDir, 'PLAN.md'));
    if (got === null) absent += 1;
    else if (got === truth) completeCount += 1;
    else partial += 1;

    const strayBefore = fs.readdirSync(taskDir).filter((f) => f.includes('.tmp-'));
    if (strayBefore.length) {
      console.log(`  trial ${i}: temp debris from the kill: ${J(strayBefore)}`);
      // Recovery: the next write sweeps debris. Advance one phase and confirm.
      await stepIn('t', dir);
      const strayAfter = fs.readdirSync(taskDir).filter((f) => f.includes('.tmp-'));
      console.log(`  trial ${i}: after next phase, debris -> ${J(strayAfter)}`);
      leftoverTmp += strayAfter.length;
    }
  }
  console.log(`atomicity over ${TRIALS} mid-write SIGKILLs: killed=${kills} caught_in_write=${sawTmp} absent=${absent} complete=${completeCount} PARTIAL=${partial} leftover_tmp=${leftoverTmp}`);

  // The load-bearing assertion is PARTIAL === 0: no kill, wherever it landed,
  // ever left a truncated artifact. The kill/absent/complete counts only show
  // the sweep actually spanned the write window rather than missing it.
  const ok = doomed.signal === 'SIGKILL'
    && restart.line.status.nextPhase === 'execute'
    && after.line.status.nextPhase === 'plan'
    && partial === 0 && leftoverTmp === 0
    && kills >= TRIALS / 2 && absent > 0 && completeCount > 0;
  (ok ? pass : fail)('P5', ok
    ? `restart resumed from disk; deleting an artifact re-queued it; ${kills} mid-write SIGKILLs spanning the write window, 0 partial artifacts`
    : `restart/atomicity check failed (partial=${partial}, leftover_tmp=${leftoverTmp}, kills=${kills}, absent=${absent}, complete=${completeCount})`);
}

async function P6() {
  header('P6', 'out-of-order / unknown task / step after ship');
  await discussIn('p6', ROOT, 'guard; rails');

  const oo = await expectError(() => childOrThrow(stepIn('p6', ROOT, { phase: 'execute' })));
  console.log(`execute before plan -> ${J(oo)}`);

  const oo2 = await expectError(() => childOrThrow(stepIn('p6', ROOT, { phase: 'verify' })));
  console.log(`verify before execute -> ${J(oo2)}`);

  const unknown = await expectError(() => childOrThrow(statusIn('no-such-task', ROOT)));
  console.log(`status of unknown task -> ${J(unknown)}`);

  await stepIn('p6', ROOT); // plan
  await stepIn('p6', ROOT); // execute
  await stepIn('p6', ROOT); // verify
  await stepIn('p6', ROOT); // ship
  const shipped = await expectError(() => childOrThrow(stepIn('p6', ROOT)));
  console.log(`step after ship -> ${J(shipped)}`);

  const ok = oo?.code === 'E_OUT_OF_ORDER' && oo2?.code === 'E_OUT_OF_ORDER'
    && unknown?.code === 'E_UNKNOWN_TASK' && shipped?.code === 'E_ALREADY_SHIPPED';
  (ok ? pass : fail)('P6', ok
    ? 'E_OUT_OF_ORDER, E_UNKNOWN_TASK and E_ALREADY_SHIPPED all raised with specific messages'
    : 'one or more error codes were wrong');
}

async function P7() {
  header('P7', 'determinism — same taskId + same input twice');
  const rootA = path.join(ROOT, 'det-a');
  const rootB = path.join(ROOT, 'det-b');
  const input = 'deterministic; reproducible; identical';
  const taskId = 'same-task';

  const a = await runChild('run', taskId, rootA, { input });
  const b = await runChild('run', taskId, rootB, { input });
  console.log(`run A pid ${a.pid} -> sequence ${J(a.line.result.artifacts)}`);
  console.log(`run B pid ${b.pid} -> sequence ${J(b.line.result.artifacts)}`);

  let allSame = true;
  for (const f of FILES) {
    const ha = sha(readIf(path.join(rootA, taskId, f)));
    const hb = sha(readIf(path.join(rootB, taskId, f)));
    const same = ha === hb;
    if (!same) allSame = false;
    console.log(`  ${f.padEnd(12)} A=${ha.slice(0, 16)}…  B=${hb.slice(0, 16)}…  ${same ? 'IDENTICAL' : 'DIFFERENT'}`);
  }

  const pathLeak = FILES.some((f) => (readIf(path.join(rootA, taskId, f)) ?? '').includes(rootA));
  console.log(`artifact bytes embed the absolute root path (must be false): ${pathLeak}`);
  const timeLeak = FILES.some((f) => /\b20\d\d-\d\d-\d\dT/.test(readIf(path.join(rootA, taskId, f)) ?? ''));
  console.log(`artifact bytes embed a timestamp (must be false): ${timeLeak}`);

  const seqOk = JSON.stringify(a.line.result.artifacts) === JSON.stringify(b.line.result.artifacts);
  const ok = seqOk && allSame && !pathLeak && !timeLeak;
  (ok ? pass : fail)('P7', ok
    ? 'identical phase sequence and identical artifact hashes'
    : 'determinism broken');
}

/* ───────────────────────── driver ───────────────────────── */

console.log(`PROBE phase22-e  repo=${REPO}  node=${process.version}`);
console.log(`gsd module: ${GSD_MODULE}`);
console.log(`probe root: ${ROOT}`);

await P1();
await P2();
await P3();
await P4();
await P5();
await P6();
await P7();

console.log('\n──────────── VERDICTS ────────────');
for (const [k, v] of Object.entries(results)) console.log(`${k}: ${v}`);
const anyFail = Object.values(results).some((v) => v.startsWith('FAIL'));
process.exit(anyFail ? 1 : 0);
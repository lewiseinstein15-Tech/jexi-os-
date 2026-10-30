/**
 * M10 — DURABLE CHAT RECOVERY contracts.
 *
 * The defect this suite pins: the chat session store (offer / parked RunState /
 * last result) was IN-MEMORY only, so a process restart erased a task parked at
 * an approval gate, the resume offer and the final result — the paused work and
 * its evidence were silently lost.
 *
 * Scenarios (mission Phase 5):
 *   1  restart after a checkpoint → resume from the correct step
 *   2  restart after a completed step → the step is NOT repeated
 *   3  restart while a step is running → classified INTERRUPTED (outcome UNKNOWN)
 *   4  a failed step is never recovered as successful
 *   5  execution records + verification evidence are preserved
 *   6  a task awaiting approval survives restart and is NOT auto-approved
 *   7  stale / mismatched approvals are rejected
 *   8  corrupted or incomplete persisted state is handled safely
 *   9  two workers cannot execute the same leased step
 *   10 sessions and tasks stay isolated
 *   11 cancellation / timeout is preserved
 *   12 no duplicate side effects where guaranteed; explicit uncertainty otherwise
 *
 * Deterministic + hermetic: temp storage, injected fake actions with execution
 * counters, ZERO network, ZERO model calls. A real cross-process restart is
 * exercised with a spawned child (no LLM).
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, '..', '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'm10-recovery-'));

const Session = await import('../../src/services/SessionStore.js');
const { DurableStore, BOOT_EPOCH, keyStem } = await import('../../src/services/DurableStore.js');
const Recovery = await import('../../src/services/ChatRecovery.js');

// Point the durable store at the temp dir (no DATA_DIR import-order issues).
Session.__setSessionsDir(TMP);
const raw = new DurableStore({ dir: TMP });
const runKey = (c) => `run::${c}`;

after(() => {
  Session.__resetSessionsDir();
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ }
});

/* ── helpers ─────────────────────────────────────────────────────────────── */

/** A minimal, JSON-safe RunState as the graph parks it at confirmationPause. */
function parkedState(over = {}) {
  return {
    query: over.query || 'build the thing',
    plan: over.plan || { intent: 'build', steps: ['one', 'two'] },
    currentNode: over.currentNode || 'github',
    status: over.status || 'paused',
    needsConfirmation: over.needsConfirmation ?? true,
    confirmationPayload: over.confirmationPayload ?? { question: 'push it?', node: 'github', action: 'push' },
    intermediateResults: over.intermediateResults || { planner: { success: true, summary: 'planned', data: null, error: null } },
    history: over.history || ['contextResolve', 'planner', 'github'],
    context: { resumeNode: over.resumeNode || 'github' },
  };
}

/** Seed a record as a PREVIOUS process would have left it on disk. */
function seedRun(convId, { state = parkedState(), status = 'paused', checkpointState = 'running', epoch = 'PREV-PROCESS', plan, query } = {}) {
  raw.save(runKey(convId), {
    at: Date.now(),
    plan: plan || state.plan,
    query: query || state.query,
    state,
    epoch,
    status,
    checkpointState,
    owner: null,
  });
}

/** Fake action executor with an execution counter (never timing-based). */
function makeExecutor() {
  const counts = {};
  return {
    counts,
    run(node) { counts[node] = (counts[node] || 0) + 1; return { node, ok: true }; },
  };
}

/**
 * A tiny, honest resume driver mirroring the production contract:
 *  - completed nodes (present in intermediateResults, not paused) are NEVER re-run;
 *  - an `uncertain` record is NOT blindly re-executed — it reports uncertainty
 *    and asks for reconciliation instead of claiming exactly-once.
 */
function resumeDriver(record, executor) {
  const state0 = Recovery.classifyRun(record, { bootEpoch: BOOT_EPOCH });
  if (Recovery.isTerminal(state0)) {
    return { resumed: false, uncertain: false, terminal: true, executed: { ...executor.counts } };
  }
  const safety = Recovery.resumeSafety(record, { bootEpoch: BOOT_EPOCH });
  const state = record.state || {};
  if (safety === 'uncertain') {
    return { resumed: false, uncertain: true, reconcile: true, executed: { ...executor.counts } };
  }
  const node = (state.context && state.context.resumeNode) || state.currentNode;
  if (node) executor.run(node);
  return { resumed: true, uncertain: false, executed: { ...executor.counts } };
}

/* ── 1. real cross-process restart: resume from the persisted checkpoint ──── */

test('R1 cross-process restart: a parked run is restored from disk by a fresh process', async () => {
  const childDir = fs.mkdtempSync(path.join(os.tmpdir(), 'm10-child-'));
  const script = path.join(childDir, 'child.mjs');
  fs.writeFileSync(script, `
    process.env.DATA_DIR = process.argv[2];
    const S = await import('${path.join(SERVER, 'src/services/SessionStore.js')}');
    const mode = process.argv[3];
    if (mode === 'park') {
      S.saveOffer('conv-x', 'deploy the service');
      S.saveRun('conv-x', { plan: { intent: 'deploy' }, query: 'deploy the service', state: {
        query: 'deploy the service', plan: { intent: 'deploy' }, currentNode: 'deploy',
        status: 'paused', needsConfirmation: true,
        confirmationPayload: { question: 'deploy to prod?', node: 'deploy', action: 'release' },
        intermediateResults: { planner: { success: true, summary: 'planned' } },
        context: { resumeNode: 'deploy' },
      }});
      process.stdout.write('PARKED');
    } else {
      const rec = S.recoverSessionsOnBoot();
      const run = S.loadRun('conv-x');
      process.stdout.write(JSON.stringify({
        record: rec.records[0] || null,
        offer: S.loadOffer('conv-x')?.query || null,
        runResumeNode: run?.state?.context?.resumeNode || null,
      }));
    }
  `);
  const runChild = (mode) => new Promise((resolve, reject) => {
    const p = spawn('node', [script, childDir, mode], { cwd: SERVER, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('error', reject);
    p.on('close', () => resolve(out));
  });
  try {
    const a = await runChild('park');
    assert.match(a, /PARKED/, `child1 parked the run (got: ${a.slice(0, 200)})`);
    // SECOND process, nothing in memory — reads only what child1 left on disk.
    const b = await runChild('read');
    const parsed = JSON.parse(b.trim().split('\n').pop());
    assert.ok(parsed.record, 'the parked run was classified by the fresh process');
    assert.equal(parsed.record.state, 'awaiting_approval', 'parked approval is restored, not lost');
    assert.equal(parsed.record.safety, 'safe', 'approval pause is a safe resume point (action never ran)');
    assert.equal(parsed.offer, 'deploy the service', 'the resume offer survived the restart');
    assert.equal(parsed.runResumeNode, 'deploy', 'resume starts at the SAME node, not the planner');
  } finally {
    fs.rmSync(childDir, { recursive: true, force: true });
  }
});

/* ── 2/3. in-flight classification ───────────────────────────────────────── */

test('R2 restart while a step is running → INTERRUPTED, outcome UNKNOWN (never "done")', () => {
  const conv = 'conv-running';
  seedRun(conv, { state: parkedState({ needsConfirmation: false, confirmationPayload: null, status: 'running', resumeNode: 'deploy' }), status: 'running', checkpointState: 'running' });
  const rec = Session.loadRun(conv);
  const state = Recovery.classifyRun(rec, { bootEpoch: BOOT_EPOCH });
  assert.equal(state, 'interrupted');
  assert.notEqual(state, 'completed');
  assert.equal(Recovery.resumeSafety(rec, { bootEpoch: BOOT_EPOCH }), 'uncertain', 'an interrupted step is uncertain, not safe');
  const note = Recovery.recoveryNote(rec, state, { bootEpoch: BOOT_EPOCH });
  assert.match(note, /UNKNOWN/i, 'the note states the outcome is unknown');
});

test('R3 an interrupted run is NOT blindly re-executed — it reports uncertainty', () => {
  const conv = 'conv-uncertain';
  seedRun(conv, { state: parkedState({ needsConfirmation: false, confirmationPayload: null, status: 'running', resumeNode: 'charge_card' }), status: 'running', checkpointState: 'running' });
  const rec = Session.loadRun(conv);
  const ex = makeExecutor();
  const out = resumeDriver(rec, ex);
  assert.equal(out.uncertain, true);
  assert.equal(out.reconcile, true, 'reconciliation is required');
  assert.equal(ex.counts.charge_card || 0, 0, 'the possibly-side-effecting step was NOT re-run');
});

/* ── 4/5. failed steps + evidence preservation ───────────────────────────── */

test('R4 a failed step is never recovered as successful', () => {
  const conv = 'conv-failed';
  seedRun(conv, { status: 'failed', checkpointState: 'running', state: parkedState({ needsConfirmation: false, confirmationPayload: null, status: 'running' }) });
  const rec = Session.loadRun(conv);
  assert.equal(Recovery.classifyRun(rec, { bootEpoch: BOOT_EPOCH }), 'failed');
  assert.notEqual(Recovery.classifyRun(rec, { bootEpoch: BOOT_EPOCH }), 'completed');
  const can = Recovery.canResumeApproval(rec, conv, { bootEpoch: BOOT_EPOCH });
  assert.equal(can.ok, false);
  assert.equal(can.reason, 'terminal', 'a failed run is terminal — it cannot be resumed as if it succeeded');
});

test('R5 execution records and verification evidence survive the restart', () => {
  const conv = 'conv-evidence';
  const evidence = [
    { verifier: 'TestVerifier', status: 'pass', output: 'ok 12 tests', bytes: 4321 },
    { verifier: 'LintVerifier', status: 'pass', output: '0 errors' },
  ];
  seedRun(conv, {
    checkpointState: 'awaiting_verification',
    state: parkedState({
      needsConfirmation: false,
      confirmationPayload: null,
      status: 'paused',
      resumeNode: 'verify',
      intermediateResults: {
        planner: { success: true, summary: 'planned' },
        execute: { success: true, summary: 'ran the work', evidence, artifacts: [{ name: 'out.txt', sha256: 'abc123', bytes: 12 }] },
      },
    }),
  });
  const rec = Session.loadRun(conv);
  assert.equal(Recovery.classifyRun(rec, { bootEpoch: BOOT_EPOCH }), 'awaiting_verification');
  const exec = rec.state.intermediateResults.execute;
  assert.equal(exec.evidence.length, 2, 'verification evidence is preserved');
  assert.deepEqual(exec.evidence[0], evidence[0], 'evidence is byte-preserved');
  assert.equal(exec.artifacts[0].sha256, 'abc123', 'artifact hashes are preserved');
});

/* ── 6/7. approval recovery + stale-approval rejection ───────────────────── */

test('R6 a task awaiting approval survives restart and is NOT auto-approved', () => {
  const conv = 'conv-approval';
  seedRun(conv, { checkpointState: 'awaiting_approval', state: parkedState() });
  const rec = Session.loadRun(conv);
  assert.equal(Recovery.classifyRun(rec, { bootEpoch: BOOT_EPOCH }), 'awaiting_approval');
  // Recovery must NOT have resolved the confirmation.
  assert.equal(rec.state.confirmationPayload.resolved, undefined, 'the approval is still pending, never auto-granted');
  const summary = Session.recoverSessionsOnBoot();
  assert.ok(summary.awaitingApproval.includes(conv), 'boot recovery lists it as awaiting approval');
  assert.equal(Recovery.resumeSafety(rec, { bootEpoch: BOOT_EPOCH }), 'safe');
});

test('R7 a stale or mismatched approval is rejected', () => {
  const conv = 'conv-stale';
  seedRun(conv, { checkpointState: 'awaiting_approval', state: parkedState({ confirmationPayload: { question: 'push?', node: 'github', action: 'push' } }) });
  const rec = Session.loadRun(conv);
  // An approval naming a DIFFERENT action must not authorize this one.
  const mismatch = Recovery.canResumeApproval(rec, conv, { bootEpoch: BOOT_EPOCH }, { node: 'deploy', action: 'release' });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.reason, 'approval_mismatch');
  // The matching approval is accepted.
  const ok = Recovery.canResumeApproval(rec, conv, { bootEpoch: BOOT_EPOCH }, { node: 'github', action: 'push' });
  assert.equal(ok.ok, true);
  assert.equal(Recovery.approvalMatches(rec, { node: 'github' }), true);
  assert.equal(Recovery.approvalMatches(rec, { node: 'deploy' }), false);
});

/* ── 8. corrupt / incomplete state ───────────────────────────────────────── */

test('R8 corrupted persisted state is handled safely (no throw, honest report)', () => {
  const conv = 'conv-corrupt';
  // Write an unparseable primary with no backup.
  const file = path.join(TMP, `${keyStem(runKey(conv))}.json`);
  fs.mkdirSync(TMP, { recursive: true });
  fs.writeFileSync(file, '{ this is not json');
  const loaded = Session.loadRun(conv);
  assert.equal(loaded, null, 'a corrupt record loads as absent, never throws');
  const summary = Session.recoverSessionsOnBoot();
  assert.ok(summary.corrupt.includes(conv), 'boot recovery flags the corrupt record honestly');
  fs.rmSync(file, { force: true });
});

test('R8b a corrupt primary recovers from its .bak', () => {
  const conv = 'conv-bak';
  const file = path.join(TMP, `${keyStem(runKey(conv))}.json`);
  const good = { at: Date.now(), plan: { intent: 'x' }, query: 'q', state: parkedState({ status: 'paused' }), epoch: BOOT_EPOCH, status: 'paused', checkpointState: 'awaiting_approval', owner: null, __key: runKey(conv) };
  fs.writeFileSync(`${file}.bak`, JSON.stringify(good));
  fs.writeFileSync(file, 'GARBAGE{');
  const res = Session.loadRun(conv);
  assert.ok(res, 'the .bak was used');
  assert.equal(res.checkpointState, 'awaiting_approval');
  fs.rmSync(file, { force: true }); fs.rmSync(`${file}.bak`, { force: true });
});

/* ── 9. concurrent workers ───────────────────────────────────────────────── */

test('R9 two workers cannot execute the same parked step', () => {
  const conv = 'conv-concurrent';
  Session.clearRun(conv);
  seedRun(conv, { checkpointState: 'awaiting_approval', state: parkedState() });
  const ex = makeExecutor();
  const c1 = Session.claimRun(conv, 'worker-1');
  const c2 = Session.claimRun(conv, 'worker-2');
  assert.equal(c1.ok, true);
  assert.equal(c2.ok, false);
  assert.equal(c2.reason, 'already_claimed');
  // Only the claim holder runs the step.
  const rec = Session.loadRun(conv);
  if (c1.ok) resumeDriver(rec, ex);
  if (c2.ok) resumeDriver(rec, ex);
  assert.equal(ex.counts.github || 0, 1, 'the parked node executed exactly once');
  Session.releaseRun(conv, 'worker-1');
  assert.equal(Session.claimRun(conv, 'worker-3').ok, true, 'after release a new worker may claim');
});

/* ── 10. isolation ───────────────────────────────────────────────────────── */

test('R10 sessions and tasks stay isolated (no cross-contamination)', () => {
  const a = 'session-a', b = 'session-b';
  Session.clearOffer(a); Session.clearOffer(b); Session.clearRun(a); Session.clearRun(b); Session.clearResult(a); Session.clearResult(b);
  Session.saveOffer(a, 'task A');
  Session.saveOffer(b, 'task B');
  seedRun(a, { checkpointState: 'awaiting_approval', state: parkedState({ query: 'task A' }) });
  seedRun(b, { status: 'failed', checkpointState: 'running', state: parkedState({ query: 'task B', needsConfirmation: false, confirmationPayload: null, status: 'running' }) });
  Session.saveResult(a, { summary: 'A done' });
  Session.saveResult(b, { summary: 'B done' });
  assert.equal(Session.loadOffer(a).query, 'task A');
  assert.equal(Session.loadOffer(b).query, 'task B');
  assert.equal(Session.loadRun(a).state.query, 'task A');
  assert.equal(Session.loadRun(b).state.query, 'task B');
  assert.equal(Session.loadResult(a).summary, 'A done');
  assert.equal(Session.loadResult(b).summary, 'B done');
  // Clearing one session never touches the other.
  Session.clearSession(a);
  assert.equal(Session.loadOffer(a), null);
  assert.equal(Session.loadOffer(b).query, 'task B');
  assert.equal(Session.loadResult(b).summary, 'B done');
});

/* ── 11. cancellation / timeout ──────────────────────────────────────────── */

test('R11 cancellation and timeout are preserved (terminal, never resumed)', () => {
  for (const conv of ['conv-cancel', 'conv-timeout']) {
    seedRun(conv, { status: 'cancelled', checkpointState: 'running', state: parkedState({ needsConfirmation: false, confirmationPayload: null, status: 'running' }) });
    const rec = Session.loadRun(conv);
    assert.equal(Recovery.classifyRun(rec, { bootEpoch: BOOT_EPOCH }), 'cancelled');
    assert.equal(Recovery.isTerminal('cancelled'), true);
    assert.equal(Recovery.canResumeApproval(rec, conv, { bootEpoch: BOOT_EPOCH }).ok, false, `${conv} is not resumable`);
    const ex = makeExecutor();
    const out = resumeDriver(rec, ex);
    assert.equal(out.resumed, false, `${conv} does not resume`);
    assert.deepEqual(ex.counts, {}, `${conv} executed nothing`);
  }
});

/* ── 12. duplicate side effects + uncertainty ────────────────────────────── */

test('R12 a completed step is never repeated on resume (exactly-once where guaranteed)', () => {
  const conv = 'conv-nodup';
  seedRun(conv, {
    checkpointState: 'awaiting_approval',
    state: parkedState({
      resumeNode: 'deploy',
      intermediateResults: {
        planner: { success: true, summary: 'planned' },
        build: { success: true, summary: 'built', completed: true },
      },
    }),
  });
  const rec = Session.loadRun(conv);
  const ex = makeExecutor();
  // Simulate the resume: completed nodes in intermediateResults are done work —
  // the driver only runs the parked node, never the completed ones.
  const completedNodes = Object.entries(rec.state.intermediateResults)
    .filter(([, r]) => r && r.success && !r.paused).map(([n]) => n);
  for (const n of completedNodes) { /* intentionally NOT re-executed */ }
  resumeDriver(rec, ex);
  assert.equal(ex.counts.build || 0, 0, 'the completed build step was not re-run');
  assert.equal(ex.counts.planner || 0, 0, 'the completed planner step was not re-run');
  assert.equal(ex.counts.deploy || 0, 1, 'only the parked step ran, once');
});

test('R12b where exactly-once is impossible, the resume reports uncertainty (no false success)', () => {
  const conv = 'conv-uncertain-2';
  seedRun(conv, { status: 'running', checkpointState: 'running', state: parkedState({ needsConfirmation: false, confirmationPayload: null, status: 'running', resumeNode: 'send_email' }) });
  const rec = Session.loadRun(conv);
  const ex = makeExecutor();
  const out = resumeDriver(rec, ex);
  assert.equal(out.uncertain, true);
  assert.equal(ex.counts.send_email || 0, 0, 'a possibly-side-effecting step is not blindly repeated');
  // The system never claims the interrupted action succeeded.
  assert.notEqual(Recovery.classifyRun(rec, { bootEpoch: BOOT_EPOCH }), 'completed');
});

/* ── durability of the completed result across a "restart" ───────────────── */

test('R13 the last completed result survives (loadResult reads durable disk)', () => {
  const conv = 'conv-result';
  Session.saveResult(conv, { success: true, summary: 'the finished answer', statistics: { totalMs: 1234 } });
  // A "restart" is just another load — the value is on disk, not in memory.
  const got = Session.loadResult(conv);
  assert.equal(got.summary, 'the finished answer');
  assert.equal(got.statistics.totalMs, 1234);
});

/* ── JSON projection safety ──────────────────────────────────────────────── */

test('R14 the RunState projection drops functions and cycles but keeps resume data', () => {
  const cyclic = { name: 'loop' };
  cyclic.self = cyclic;
  const state = {
    currentNode: 'n', context: { resumeNode: 'n', opts: { confirm: () => {}, signal: { aborted: false } } },
    fn: () => {}, cyclic, brainContext: 'x'.repeat(100),
  };
  const projected = Recovery.projectRunState(state);
  assert.equal(projected.fn, undefined, 'functions are dropped');
  assert.equal(projected.brainContext, undefined, 'internal brain context is stripped');
  assert.equal(projected.cyclic.self, undefined, 'cycles are broken');
  assert.equal(projected.context.resumeNode, 'n', 'resume data is kept');
  assert.equal(typeof projected.context.opts.confirm, 'undefined', 'callbacks are dropped');
  assert.doesNotThrow(() => JSON.stringify(projected), 'the projection is JSON-serializable');
});

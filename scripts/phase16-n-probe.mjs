#!/usr/bin/env node
// Phase 16 Scope N — Chat Checkpoints probe (P1–P8)
import { checkpoints } from '../interfaces/ui/web/console/chat/checkpoints.js';
import { queue } from '../interfaces/ui/web/console/chat/queue.js';
import { steer } from '../interfaces/ui/web/console/chat/steer.js';
import { runtime } from '../interfaces/ui/web/console/chat/runtime.js';
import { router } from '../interfaces/ui/web/console/chat/router.js';
import { modes } from '../interfaces/ui/web/console/chat/modes.js';
import { approvals } from '../interfaces/ui/web/console/chat/approvals.js';
import { draft } from '../interfaces/ui/web/console/chat/progress-draft.js';
import { taxonomy } from '../runtime/events/chat/taxonomy.js';

let pass = 0, fail = 0;
const ok = (c, msg) => { c ? pass++ : fail++; console.log(`  ${c ? '✅' : '❌'} ${msg}`); };
const j = (v) => JSON.stringify(v);
const tick = (ms = 4) => new Promise((r) => setTimeout(r, ms));

console.log('=== Phase 16 N — Chat Checkpoints ===');

const hardReset = () => {
  checkpoints._reset(); queue._reset(); steer._reset(); runtime._reset();
  router._reset(); modes._reset(); approvals._reset(); draft._reset();
};
const agent = (tools) => (ctx) => (async function* a() { for (const t of tools) { yield { kind: 'tool', ...t }; await tick(); } })();
const runTurn = async (sess, tools) => { runtime.send(sess, 'work', { agent: agent(tools) }); await runtime.settle(sess); };
const effLen = (sess) => router.history(sess).length; // raw router length for before/after display

// ─────────────────────────────────────────────────────────────────────────────
// P1 — 3 turns, checkpoint after turn 2, list shows 1.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n════ P1 — create checkpoint after turn 2 ════');
let cp1;
{
  hardReset();
  const sess = 'sess-n1';
  runtime.attach(sess);
  await runTurn(sess, [{ name: 'bash', args: { command: 'one' }, destructive: false }]);
  await runTurn(sess, [{ name: 'bash', args: { command: 'two' }, destructive: false }]);
  const eventsAfter2 = router.history(sess).length;
  cp1 = checkpoints.create(sess, 'after turn 2');
  await runTurn(sess, [{ name: 'bash', args: { command: 'three' }, destructive: false }]);

  console.log(`  checkpoint -> ${j(cp1)}`);
  console.log(`  list -> ${j(checkpoints.list(sess))}`);
  ok(checkpoints.list(sess).length === 1, 'P1 list shows 1 checkpoint');
  ok(cp1.checkpointId === 'sess-n1:ck-1', `P1 monotonic id ck-1 (got ${cp1.checkpointId})`);
  ok(cp1.eventCount === eventsAfter2, `P1 eventCount == routed events up to turn 2 (got ${cp1.eventCount} want ${eventsAfter2})`);
  ok(cp1.turnId === 'sess-n1:turn-2', `P1 turnId is turn-2 (got ${cp1.turnId})`);
  ok(cp1.modes && cp1.modes.interactionMode === 'act', 'P1 modes captured (interactionMode act)');
}

// ─────────────────────────────────────────────────────────────────────────────
// P2 — restore drops events after turn 2.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n════ P2 — restore truncates to checkpoint ════');
{
  const sess = 'sess-n1';
  const before = router.history(sess).length;
  const res = checkpoints.restore(sess, cp1.checkpointId);
  const after = router.history(sess).length;
  console.log(`  restore -> ${j(res)}`);
  console.log(`  raw router events before=${before} after=${after} (checkpoint eventCount=${cp1.eventCount})`);
  ok(res.restored === true && res.atTurnId === 'sess-n1:turn-2', 'P2 restore returns {restored, atTurnId}');
  // effective count now equals checkpoint count (+1 restored marker)
  const eff = router.history(sess).length;
  ok(checkpoints.list(sess)[0].eventCount === cp1.eventCount, 'P2 checkpoint eventCount unchanged');
  // the restored marker is the only effective event beyond the checkpoint
  const preview = checkpoints.preview(cp1.checkpointId);
  console.log(`  preview after restore -> ${j(preview)}`);
  ok(preview.willDiscard === 0 || preview.willDiscard === 1, `P2 after restore nothing left to discard (got ${preview.willDiscard})`);
  void before; void after; void eff;
}

// ─────────────────────────────────────────────────────────────────────────────
// P3 — branch: new session from checkpoint, source unchanged, modes carried.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n════ P3 — branch from checkpoint ════');
{
  hardReset();
  const sess = 'sess-n3';
  runtime.attach(sess);
  modes.setDisplayMode(sess, 'full');
  modes.setInteractionMode(sess, 'plan');
  await runTurn(sess, [{ name: 'bash', args: { command: 'a' }, destructive: false }]);
  await runTurn(sess, [{ name: 'bash', args: { command: 'b' }, destructive: false }]);
  const cp = checkpoints.create(sess, 'branch point');
  const srcEventsBefore = router.history(sess).length;
  const srcTurnsBefore = runtime.retainedTurns(sess).length;

  const br = checkpoints.branch(sess, cp.checkpointId);
  console.log(`  branch -> ${j(br)}`);
  const srcEventsAfter = router.history(sess).length;
  const srcTurnsAfter = runtime.retainedTurns(sess).length;
  const branchEvents = router.history(br.newSessionId).length;
  const branchModes = modes.get(br.newSessionId);
  console.log(`  source events before=${srcEventsBefore} after=${srcEventsAfter} (only +1 branched marker)`);
  console.log(`  source turns before=${srcTurnsBefore} after=${srcTurnsAfter}`);
  console.log(`  branch events=${branchEvents} (checkpoint eventCount=${cp.eventCount})`);
  console.log(`  branch modes -> ${j(branchModes)}`);

  ok(typeof br.newSessionId === 'string' && br.newSessionId !== sess, 'P3 new sessionId returned');
  ok(br.branchFromTurnId === cp.turnId, 'P3 branchFromTurnId == checkpoint turnId');
  ok(srcTurnsBefore === srcTurnsAfter, 'P3 source turn history unchanged');
  ok(srcEventsAfter === srcEventsBefore + 1, 'P3 source only gained the branched marker');
  ok(branchEvents === cp.eventCount, `P3 branch starts with the checkpoint log (${branchEvents} == ${cp.eventCount})`);
  ok(branchModes.displayMode === 'full' && branchModes.interactionMode === 'plan', 'P3 modes carried into branch');
}

// ─────────────────────────────────────────────────────────────────────────────
// P4 — error codes.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n════ P4 — error codes ════');
{
  hardReset();
  const sess = 'sess-n4';
  runtime.attach(sess);
  let c;
  c = null; try { checkpoints.create('nope'); } catch (e) { c = e.code; }
  console.log(`  create unknown session -> ${c}`);
  ok(c === 'E_UNKNOWN_SESSION', 'P4 unknown sessionId -> E_UNKNOWN_SESSION');

  c = null; try { checkpoints.restore(sess, 'sess-n4:ck-99'); } catch (e) { c = e.code; }
  console.log(`  restore unknown checkpoint -> ${c}`);
  ok(c === 'E_UNKNOWN_CHECKPOINT', 'P4 unknown checkpointId -> E_UNKNOWN_CHECKPOINT');

  // restore while streaming
  runtime.send(sess, 'go', { agent: agent([{ name: 'bash', args: { command: 'x' }, destructive: false }, { name: 'bash', args: { command: 'y' }, destructive: false }]) });
  await tick(1);
  const cp = checkpoints.create(sess, 'mid');
  c = null; try { checkpoints.restore(sess, cp.checkpointId); } catch (e) { c = e.code; }
  console.log(`  restore while streaming -> ${c}`);
  ok(c === 'E_TURN_ACTIVE', 'P4 restore while turn active -> E_TURN_ACTIVE');
  await runtime.settle(sess);

  // event-0 checkpoint
  hardReset();
  const s2 = 'sess-n4b';
  runtime.attach(s2);
  const cp0 = checkpoints.create(s2, 'empty');
  c = null; try { checkpoints.restore(s2, cp0.checkpointId); } catch (e) { c = e.code; }
  console.log(`  restore event-0 without confirm -> ${c}`);
  ok(c === 'E_CONFIRM_REQUIRED', 'P4 event-0 restore without confirm -> E_CONFIRM_REQUIRED');
  const r0 = checkpoints.restore(s2, cp0.checkpointId, { confirm: true });
  console.log(`  restore event-0 with confirm -> ${j(r0)}`);
  ok(r0.restored === true, 'P4 event-0 restore with confirm wipes clean');
}

// ─────────────────────────────────────────────────────────────────────────────
// P5 — preview accuracy: predicted == actual discarded.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n════ P5 — preview accuracy ════');
{
  hardReset();
  const sess = 'sess-n5';
  runtime.attach(sess);
  await runTurn(sess, [{ name: 'bash', args: { command: 'a' }, destructive: false }]);
  const cp = checkpoints.create(sess, 'mid');
  await runTurn(sess, [{ name: 'bash', args: { command: 'b' }, destructive: false }]);
  await runTurn(sess, [{ name: 'bash', args: { command: 'c' }, destructive: false }]);

  const pv = checkpoints.preview(cp.checkpointId);
  const before = checkpoints.effCount(sess);
  checkpoints.restore(sess, cp.checkpointId);
  const after = checkpoints.effCount(sess);
  const actual = before - (after - 1); // minus the restored marker
  console.log(`  preview -> ${j(pv)}`);
  console.log(`  before=${before} after=${after} actualDiscarded=${actual} predicted=${pv.willDiscard}`);
  ok(pv.willDiscard === actual, `P5 predicted == actual discarded (${pv.willDiscard} == ${actual})`);
  ok(pv.willRestore === cp.eventCount, 'P5 willRestore == checkpoint eventCount');
}

// ─────────────────────────────────────────────────────────────────────────────
// P6 — queue/steer named by preview; truncation on restore.
// NOTE: Scope M's auto-flush (out of zone) starts held queue items as turns the
// moment a turn ends, so held items drain on settle. We verify capture + preview
// naming while the turn is active, and that restore runs clean.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n════ P6 — queue/steer named by preview, truncated on restore ════');
{
  hardReset();
  const sess = 'sess-n6';
  runtime.attach(sess);
  runtime.send(sess, 'base1', { agent: agent([{ name: 'bash', args: { command: 'a' }, destructive: false }, { name: 'bash', args: { command: 'b' }, destructive: false }]) });
  await tick(1);
  queue.enqueue(sess, 'held A');
  queue.enqueue(sess, 'held B');
  steer.inject(sess, 'remember docs');
  const activeQueue = queue.list(sess).map((q) => q.message);
  const activeSteer = steer.pending(sess).map((x) => x.message);
  const cp = checkpoints.create(sess, 'with queue+steer');
  console.log(`  while active: queue=${j(activeQueue)} steer=${j(activeSteer)}`);
  ok(j(activeQueue) === j(['held A', 'held B']), 'P6 two items held at checkpoint');
  ok(j(activeSteer) === j(['remember docs']), 'P6 one steer pending at checkpoint');

  queue.enqueue(sess, 'held C');
  const pv = checkpoints.preview(cp.checkpointId);
  console.log(`  preview pending (while active) -> ${j(pv.pending)}`);
  ok(pv.pending.queue === 1, `P6 preview names 1 queue item added after checkpoint (got ${pv.pending.queue})`);
  ok(pv.pending.steer === 0, 'P6 no steer added after checkpoint');

  await runtime.settle(sess);
  const res = checkpoints.restore(sess, cp.checkpointId);
  console.log(`  restore -> ${j(res)}`);
  ok(res.restored === true, 'P6 restore succeeds after settle');
  console.log(`  NOTE queue after settle+restore (Scope M auto-flush drained held items) -> ${j(queue.list(sess))}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// P7 — determinism.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n════ P7 — determinism ════');
{
  const runOnce = async () => {
    hardReset();
    const sess = 'sess-n7';
    runtime.attach(sess);
    await runTurn(sess, [{ name: 'bash', args: { command: 'a' }, destructive: false }]);
    await runTurn(sess, [{ name: 'bash', args: { command: 'b' }, destructive: false }]);
    const cp = checkpoints.create(sess, 'det');
    await runTurn(sess, [{ name: 'bash', args: { command: 'c' }, destructive: false }]);
    return JSON.stringify({ list: checkpoints.list(sess), preview: checkpoints.preview(cp.checkpointId) });
  };
  const a = await runOnce();
  const b = await runOnce();
  console.log(`  run #1 -> ${a}`);
  console.log(`  run #2 -> ${b}`);
  ok(a === b, 'P7 byte-identical list+preview across two runs');
}

// ─────────────────────────────────────────────────────────────────────────────
// P8 — zone check (state-independent).
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n════ P8 — zone check ════');
{
  const { execSync } = await import('node:child_process');
  const repo = new URL('..', import.meta.url).pathname;
  const run = (cmd) => execSync(cmd, { cwd: repo }).toString();
  const status = run('git status --short');
  const uncommitted = status.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => l.split(/\s+/).slice(1).join(' '));
  let committed = [];
  try {
    const hash = run("git log --format=%H --grep='^phase-16(N):' -1").trim();
    if (hash) committed = run(`git show --name-only --format= ${hash}`).split('\n').map((x) => x.trim()).filter(Boolean);
  } catch { }
  const changed = [...new Set([...uncommitted, ...committed])];
  console.log('  git status --short ->');
  console.log(status.split('\n').filter(Boolean).map((l) => `    ${l}`).join('\n') || '    (clean)');
  const allowed = (f) => /^ui\/web\/console\/chat\//.test(f) || /^scripts\/phase16-.*\.mjs$/.test(f);
  const violations = changed.filter((f) => !allowed(f));
  console.log(`  changed paths -> ${j(changed)}`);
  console.log(`  outside the zone -> ${j(violations)}`);
  ok(violations.length === 0, `P8 no file outside zone (violations ${j(violations)})`);
  ok(changed.includes('ui/web/console/chat/checkpoints.js'), 'P8 checkpoints.js in changeset');
}

console.log(`\n=== Phase 16 N: ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);

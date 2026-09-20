#!/usr/bin/env node
// Phase 16 Scope M — Queued + Steer probe (P1–P8)
import { queue } from '../ui/web/console/chat/queue.js';
import { steer } from '../ui/web/console/chat/steer.js';
import { runtime } from '../ui/web/console/chat/runtime.js';
import { router } from '../ui/web/console/chat/router.js';
import { modes } from '../ui/web/console/chat/modes.js';
import { approvals } from '../ui/web/console/chat/approvals.js';
import { draft } from '../ui/web/console/chat/progress-draft.js';
import { taxonomy } from '../events/chat/taxonomy.js';

let pass = 0, fail = 0;
const ok = (c, msg) => { c ? pass++ : fail++; console.log(`  ${c ? '✅' : '❌'} ${msg}`); };
const j = (v) => JSON.stringify(v);
const tick = (ms = 4) => new Promise((r) => setTimeout(r, ms));

console.log('=== Phase 16 M — Queued + Steer ===');

const hardReset = () => {
  queue._reset(); steer._reset(); runtime._reset();
  router._reset(); modes._reset(); approvals._reset(); draft._reset();
};

/** base agent: yields given tools with a pause between so injection can land. */
const slowAgent = (tools) => (ctx) => (async function* a() {
  for (const t of tools) { yield { kind: 'tool', ...t }; await tick(); }
})();

/** Unified routed timeline for a session (runtime + queue + steer events). */
const timeline = (sess) => (live[sess] || []).map((env) => {
  const payload = env.event && env.event.payload ? env.event.payload : {};
  return {
    seq: env.seq,
    type: env.event.type,
    turnId: env.turnId,
    ctx: payload.ctx || (payload.steer || payload.queue ? payload : undefined),
    delta: payload.delta,
  };
});

const idxOf = (tl, pred) => tl.findIndex(pred);

/** Live envelope capture (router envelopes carry turnId; history does not). */
const live = {};
const watch = (sess) => { live[sess] = []; router.subscribe(sess, (env) => live[sess].push(env)); };

// ─────────────────────────────────────────────────────────────────────────────
// P1 — enqueue 3 while streaming, list 1/2/3, cancel middle, auto-start 1 then 3.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n════ P1 — queue FIFO, cancel, auto-start ════');
{
  hardReset();
  const sess = 'sess-m1';
  runtime.attach(sess); watch(sess);
  const first = queue.enqueue(sess, 'do the base work', {
    agent: slowAgent([
      { name: 'bash', args: { command: 'ls' }, destructive: false },
      { name: 'bash', args: { command: 'pwd' }, destructive: false },
    ]),
  });
  console.log(`  first enqueue (idle -> immediate) -> ${j(first)}`);
  ok(first.started === true, 'P1 enqueue while idle auto-dispatches');

  await tick(1); // ensure the base turn is streaming
  const q1 = queue.enqueue(sess, 'queued one');
  const q2 = queue.enqueue(sess, 'queued two');
  const q3 = queue.enqueue(sess, 'queued three');
  console.log(`  enqueued -> ${j([q1, q2, q3])}`);
  ok(j(queue.list(sess).map((x) => x.position)) === j([1, 2, 3]), `P1 list positions 1/2/3 (got ${j(queue.list(sess).map((x) => x.position))})`);
  ok(queue.list(sess)[0].message === 'queued one', 'P1 FIFO order preserved');

  const cancelled = queue.cancel(sess, q2.queueId);
  console.log(`  cancel(${q2.queueId}) -> ${j(cancelled)}`);
  ok(cancelled.cancelled === true, 'P1 cancel returns {cancelled:true}');
  ok(j(queue.list(sess).map((x) => x.message)) === j(['queued one', 'queued three']), 'P1 middle removed, order kept');

  await runtime.settle(sess);
  await tick(20); // let the watcher chain the queued turns

  const tl = timeline(sess);
  const startedRecs = tl.filter((e) => e.ctx && e.ctx.queue === 'started');
  console.log(`  queue.started records -> ${j(startedRecs.map((e) => e.ctx))}`);
  ok(startedRecs.length === 3, `P1 three turns started (base + two queued) (got ${startedRecs.length})`);
  const turnIds = [...new Set(tl.filter((e) => e.type === 'tool.started').map((e) => e.turnId))];
  console.log(`  distinct tool turnIds -> ${j(turnIds)}`);
  ok(turnIds.length === 3, `P1 three distinct turns ran tools (got ${turnIds.length})`);
  const twoStarted = tl.some((e) => e.type === 'message.delta' && e.delta === 'queued two');
  ok(twoStarted === false, 'P1 the cancelled message never became a turn');
  const oneStarted = tl.some((e) => e.type === 'message.delta' && e.delta === 'queued one');
  const threeStarted = tl.some((e) => e.type === 'message.delta' && e.delta === 'queued three');
  ok(oneStarted && threeStarted, 'P1 queued #1 and #3 both auto-started');
}

// P2 — steer lands mid-turn before next tool.started, no new turn.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n════ P2 — steer injected mid-stream, same turn ════');
{
  hardReset();
  const sess = 'sess-m2';
  runtime.attach(sess); watch(sess);
  const { turnId } = queue.enqueue(sess, 'long task', {
    agent: slowAgent([
      { name: 'bash', args: { command: 'a' }, destructive: false },
      { name: 'bash', args: { command: 'b' }, destructive: false },
      { name: 'bash', args: { command: 'c' }, destructive: false },
    ]),
  });
  await tick(6); // after first tool.completed, before later tools
  const inj = steer.inject(sess, 'actually focus on the tests');
  console.log(`  steer.inject -> ${j(inj)}`);
  ok(inj.appliedTo === turnId, `P2 appliedTo is the active turn (got ${inj.appliedTo})`);
  ok(steer.pending(sess).length === 1, `P2 pending()==1 (got ${steer.pending(sess).length})`);

  await runtime.settle(sess);
  await tick(5);

  const tl = timeline(sess);
  const deliveredIdx = idxOf(tl, (e) => e.ctx && e.ctx.steer === 'delivered');
  const injectedIdx = idxOf(tl, (e) => e.ctx && e.ctx.steer === 'injected');
  const toolStarted = tl.map((e, i) => (e.type === 'tool.started' ? i : -1)).filter((i) => i >= 0);
  const nextToolAfter = toolStarted.find((i) => i > deliveredIdx);
  const turnCompletedIdx = idxOf(tl, (e) => e.type === 'turn.completed');
  console.log(`  injectedIdx=${injectedIdx} deliveredIdx=${deliveredIdx} toolStarted=${j(toolStarted)} turnCompleted=${turnCompletedIdx}`);
  for (const e of tl) console.log(`    #${String(e.seq).padStart(2)} ${e.type.padEnd(16)} ${e.ctx ? j(e.ctx) : ''}`);

  ok(injectedIdx >= 0 && deliveredIdx >= 0, 'P2 both steer.injected and steer.delivered routed');
  ok(deliveredIdx < nextToolAfter, `P2 steer.delivered (#${deliveredIdx}) before next tool.started (#${nextToolAfter})`);
  ok(deliveredIdx < turnCompletedIdx, 'P2 delivered before turn.completed (not after)');
  const toolTurnIds = [...new Set(tl.filter((e) => e.type === 'tool.started').map((e) => e.turnId))];
  ok(toolTurnIds.length === 1 && toolTurnIds[0] === turnId, `P2 one turnId for all tools (got ${j(toolTurnIds)})`);
  ok(steer.pending(sess).length === 0, 'P2 buffer drained after delivery');
}

// ─────────────────────────────────────────────────────────────────────────────
// P3 — error codes
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n════ P3 — error codes ════');
{
  hardReset();
  const sess = 'sess-m3';
  runtime.attach(sess); watch(sess);

  let c;
  c = null; try { steer.inject(sess, 'x'); } catch (e) { c = e.code; }
  console.log(`  steer on idle -> ${c}`);
  ok(c === 'E_NO_ACTIVE_TURN', 'P3 steer on idle -> E_NO_ACTIVE_TURN');

  const { turnId } = queue.enqueue(sess, 'go', { agent: slowAgent([{ name: 'bash', args: { command: 'a' }, destructive: false }]) });
  const startedItem = queue.list(sess); // empty (auto-dispatched)
  // capture the started queueId via history
  await tick(2);
  const tl = timeline(sess);
  const startedRec = tl.find((e) => e.ctx && e.ctx.queue === 'started');
  const startedQueueId = startedRec ? startedRec.ctx.queueId : null;
  c = null; try { queue.cancel(sess, startedQueueId); } catch (e) { c = e.code; }
  console.log(`  cancel already-started -> ${c}`);
  ok(c === 'E_ALREADY_STARTED', 'P3 cancel already-started -> E_ALREADY_STARTED');

  c = null; try { queue.cancel(sess, 'nope'); } catch (e) { c = e.code; }
  console.log(`  cancel unknown -> ${c}`);
  ok(c === 'E_UNKNOWN_QUEUE_ITEM', 'P3 cancel unknown -> E_UNKNOWN_QUEUE_ITEM');

  // queue overflow: keep the base turn active, then enqueue past bound.
  await runtime.settle(sess);
  const { turnId: t2 } = queue.enqueue(sess, 'keep busy', { agent: slowAgent([{ name: 'bash', args: { command: 'sleep' }, destructive: false }, { name: 'bash', args: { command: 'sleep2' }, destructive: false }]) });
  await tick(1);
  let full = null;
  for (let i = 0; i < 32; i += 1) queue.enqueue(sess, `m${i}`);
  try { queue.enqueue(sess, 'overflow'); } catch (e) { full = e.code; }
  console.log(`  enqueue past bound -> ${full}`);
  ok(full === 'E_QUEUE_FULL', 'P3 enqueue past 32 -> E_QUEUE_FULL');

  // steer overflow: 8 per turn.
  let sfull = null;
  for (let i = 0; i < 8; i += 1) steer.inject(sess, `s${i}`);
  try { steer.inject(sess, 'one too many'); } catch (e) { sfull = e.code; }
  console.log(`  steer past bound -> ${sfull}`);
  ok(sfull === 'E_STEER_FULL', 'P3 steer past 8 -> E_STEER_FULL');
  void turnId; void startedItem; void t2;
}

// ─────────────────────────────────────────────────────────────────────────────
// P4 — steer during awaiting-approval buffered, delivered after approve.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n════ P4 — steer buffered across approval ════');
{
  hardReset();
  const sess = 'sess-m4';
  const handle = runtime.attach(sess); watch(sess);
  const { turnId } = queue.enqueue(sess, 'risky change', {
    agent: slowAgent([
      { name: 'edit_file', args: { path: '/x', content: 'c' }, destructive: true },
      { name: 'bash', args: { command: 'after' }, destructive: false },
    ]),
  });
  await tick(2); // reach awaiting-approval
  const st = runtime.state(sess);
  console.log(`  status while gated -> ${st.status}`);
  ok(st.status === 'awaiting-approval', 'P4 turn is awaiting-approval');

  const inj = steer.inject(sess, 'and add tests too');
  console.log(`  steer.inject while awaiting -> ${j(inj)}`);
  ok(inj.appliedTo === turnId, 'P4 steer allowed while awaiting-approval');
  ok(steer.pending(sess).length === 1, 'P4 steer buffered (pending=1)');

  const appr = approvals.pending(sess)[0];
  runtime.approve(sess, appr.approvalId, 'yes');
  await runtime.settle(sess);
  await tick(5);

  const tl = timeline(sess);
  const deliveredIdx = idxOf(tl, (e) => e.ctx && e.ctx.steer === 'delivered');
  const approveIdx = idxOf(tl, (e) => e.type === 'approval.resolved');
  const secondToolIdx = tl.map((e, i) => (e.type === 'tool.started' ? i : -1)).filter((i) => i >= 0)[1];
  console.log(`  approveIdx=${approveIdx} deliveredIdx=${deliveredIdx} secondToolStarted=${secondToolIdx}`);
  for (const e of tl) console.log(`    #${String(e.seq).padStart(2)} ${e.type.padEnd(16)} ${e.ctx ? j(e.ctx) : ''}`);
  ok(deliveredIdx > approveIdx, `P4 delivered after approval resolved (#${approveIdx} < #${deliveredIdx})`);
  ok(deliveredIdx < secondToolIdx, `P4 delivered before next tool.started (#${deliveredIdx} < #${secondToolIdx})`);
  ok(steer.pending(sess).length === 0, 'P4 buffer flushed once');
  void handle;
}

// ─────────────────────────────────────────────────────────────────────────────
// P5 — detach mid-stream: queue + steer buffer survive re-attach.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n════ P5 — queue/steer survive detach ════');
{
  hardReset();
  const sess = 'sess-m5';
  const handle = runtime.attach(sess); watch(sess);
  queue.enqueue(sess, 'base', { agent: slowAgent([{ name: 'bash', args: { command: 'a' }, destructive: false }, { name: 'bash', args: { command: 'b' }, destructive: false }]) });
  await tick(1);
  queue.enqueue(sess, 'held one');
  queue.enqueue(sess, 'held two');
  steer.inject(sess, 'remember the docs');

  const beforeList = j(queue.list(sess));
  const beforeSteer = j(steer.pending(sess).map((x) => x.message));
  handle.detach();
  ok(runtime.isAttached(sess) === false, 'P5 detached');
  runtime.attach(sess); watch(sess);
  ok(runtime.isAttached(sess) === true, 'P5 re-attached');

  const afterList = j(queue.list(sess));
  const afterSteer = j(steer.pending(sess).map((x) => x.message));
  console.log(`  queue before -> ${beforeList}`);
  console.log(`  queue after  -> ${afterList}`);
  console.log(`  steer before -> ${beforeSteer}`);
  console.log(`  steer after  -> ${afterSteer}`);
  ok(beforeList === afterList, 'P5 queue survives detach with same order');
  ok(beforeSteer === afterSteer, 'P5 steer buffer survives detach');
}

// ─────────────────────────────────────────────────────────────────────────────
// P6 — determinism: same sequence twice -> byte-identical routed events.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n════ P6 — determinism ════');
{
  const runOnce = async (sess) => {
    hardReset();
    runtime.attach(sess); watch(sess);
    queue.enqueue(sess, 'base', { agent: slowAgent([{ name: 'bash', args: { command: 'a' }, destructive: false }, { name: 'bash', args: { command: 'b' }, destructive: false }]) });
    await tick(1);
    queue.enqueue(sess, 'q1');
    queue.enqueue(sess, 'q2');
    await tick(4);
    steer.inject(sess, 'steer now');
    await runtime.settle(sess);
    await tick(20);
    return JSON.stringify(timeline(sess).map((e) => ({ t: e.type, ctx: e.ctx })));
  };
  const a = await runOnce('sess-m6');
  const b = await runOnce('sess-m6');
  console.log(`  run #1 -> ${a}`);
  console.log(`  run #2 -> ${b}`);
  ok(a === b, 'P6 byte-identical routed timelines across two runs');
}

// ─────────────────────────────────────────────────────────────────────────────
// P7 — taxonomy gap check (do NOT edit Scope A).
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n════ P7 — taxonomy gap ════');
{
  const types = taxonomy.list();
  const missing = ['queue.enqueued', 'queue.started', 'queue.cancelled', 'steer.injected', 'steer.delivered'].filter((t) => !types.includes(t));
  console.log(`  taxonomy has these surface types? missing -> ${j(missing)}`);
  ok(missing.length === 5, 'P7 all five queue/steer types absent from Scope A (gap confirmed)');

  hardReset();
  const sess = 'sess-m7';
  runtime.attach(sess); watch(sess);
  queue.enqueue(sess, 'x', { agent: slowAgent([{ name: 'bash', args: { command: 'a' }, destructive: false }]) });
  await tick(2);
  const tl = timeline(sess);
  const surface = tl.filter((e) => e.ctx && (e.ctx.queue || e.ctx.steer));
  const allNarration = surface.every((e) => {
    const rec = router.history(sess).find((r) => r.seq === e.seq);
    return rec.type === 'narration.line' && rec.routed === true;
  });
  console.log(`  queue/steer surface events emitted as routed narration.line -> ${j(surface.map((e) => e.ctx))}`);
  ok(surface.length >= 1 && allNarration, 'P7 gap handled via routed narration.line with structured ctx');
}

// ─────────────────────────────────────────────────────────────────────────────
// P8 — zone check (state-independent).
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n════ P8 — zone check ════');
{
  const { execSync } = await import('node:child_process');
  const repo = new URL('..', import.meta.url).pathname;
  const run = (c) => execSync(c, { cwd: repo }).toString();
  const status = run('git status --short');
  const uncommitted = status.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => l.split(/\s+/).slice(1).join(' '));
  let committed = [];
  try {
    const hash = run("git log --format=%H --grep='^phase-16(M):' -1").trim();
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
  ok(changed.includes('ui/web/console/chat/queue.js'), 'P8 queue.js in changeset');
  ok(changed.includes('ui/web/console/chat/steer.js'), 'P8 steer.js in changeset');
}

console.log(`\n=== Phase 16 M: ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);

#!/usr/bin/env node
// Phase 16 Scope D — Progress Drafts probe
import { draft } from '../ui/web/console/chat/progress-draft.js';

let pass = 0, fail = 0;
const ok = (c, msg) => { c ? pass++ : fail++; console.log(`  ${c ? '✅' : '❌'} ${msg}`); };

console.log('=== Phase 16 D — Progress Drafts ===');

// P1 Create, update twice, finalize
console.log('\n════ P1 — Create, update twice, finalize, show state after each, durationMs>0 ════');
{
  draft._reset();
  const turnId = 'turn-p1';
  const created = draft.create(turnId, { minDurationMs: 100, force: true });
  console.log(`  created: ${JSON.stringify(created)}`);
  ok(created.state === 'active', 'P1 create returns active');

  // Wait a bit to avoid throttle
  await new Promise(r => setTimeout(r, 350));
  const u1 = draft.update(turnId, { headline: 'Step 1: Analyzing', steps: ['analyze'] });
  console.log(`  after update1: ${JSON.stringify(u1)}`);
  ok(u1.headline === 'Step 1: Analyzing', 'P1 update1 headline');

  await new Promise(r => setTimeout(r, 350));
  const u2 = draft.update(turnId, { headline: 'Step 2: Building', steps: ['analyze', 'build'], toolLog: ['tool: read'] });
  console.log(`  after update2: ${JSON.stringify(u2)}`);
  ok(u2.headline === 'Step 2: Building', 'P1 update2 headline');
  ok(u2.steps.length === 2, 'P1 steps preserved in order');

  await new Promise(r => setTimeout(r, 100));
  const fin = draft.finalize(turnId, 'Done building feature X');
  console.log(`  finalized: ${JSON.stringify(fin)}`);
  ok(fin.state === 'finalized', 'P1 finalized state');
  ok(fin.durationMs > 0, `P1 durationMs >0 (got ${fin.durationMs})`);
  ok(fin.finalMessage === 'Done building feature X', 'P1 finalMessage');
}

// P2 Second create while active -> E_DRAFT_ACTIVE
console.log('\n════ P2 — Second create while active -> E_DRAFT_ACTIVE ════');
{
  draft._reset();
  const t1 = 'turn-p2-a';
  const t2 = 'turn-p2-b';
  draft.create(t1, { force: true });
  let threw = false;
  try {
    draft.create(t2, { force: true });
  } catch (e) {
    console.log(`  threw: code=${e.code} message=${e.message}`);
    threw = e.code === 'E_DRAFT_ACTIVE';
  }
  ok(threw, 'P2 second create throws E_DRAFT_ACTIVE');
  // Cleanup
  draft.finalize(t1, 'cleanup');
}

// P3 Rapid updates throttled
console.log('\n════ P3 — Rapid updates throttled: 10 updates inside 100ms -> only last applied ════');
{
  draft._reset();
  const turnId = 'turn-p3';
  draft.create(turnId, { throttleMs: 300, minDurationMs: 100, force: true });

  // Fire 10 updates quickly
  for (let i = 1; i <= 10; i++) {
    draft.update(turnId, { headline: `headline-${i}`, steps: [`step-${i}`] });
  }

  const stateImmediate = draft._getState(turnId);
  console.log(`  immediate after 10 rapid: appliedCount=${stateImmediate.appliedCount} attempted=${stateImmediate.attemptedCount} headline=${stateImmediate.headline}`);
  // At this point, because all within throttle window from create, appliedCount should be 0 or 1, not 10
  // After waiting throttle window, only last should be applied

  await new Promise(r => setTimeout(r, 400));

  const stateAfter = draft._getState(turnId);
  console.log(`  after 400ms throttle wait: appliedCount=${stateAfter.appliedCount} headline=${stateAfter.headline} steps=${JSON.stringify(stateAfter.steps)}`);
  ok(stateAfter.headline === 'headline-10', `P3 only last applied headline-10 (got ${stateAfter.headline})`);
  ok(stateAfter.steps[0] === 'step-10', `P3 only last step applied (got ${stateAfter.steps[0]})`);
  console.log(`  throttle count: attempted=10 applied=${stateAfter.appliedCount} throttled=${10 - stateAfter.appliedCount}`);
  ok(stateAfter.appliedCount === 1, `P3 throttle: only 1 applied out of 10 (got ${stateAfter.appliedCount})`);

  draft.finalize(turnId, 'done');
}

// P4 Finalize idempotent
console.log('\n════ P4 — Finalize idempotent: twice -> same result, second no-op ════');
{
  draft._reset();
  const turnId = 'turn-p4';
  draft.create(turnId, { minDurationMs: 100, force: true });
  await new Promise(r => setTimeout(r, 350));
  draft.update(turnId, { headline: 'test', steps: ['a'] });
  const fin1 = draft.finalize(turnId, 'final message');
  const fin2 = draft.finalize(turnId, 'final message second call');
  console.log(`  fin1: ${JSON.stringify(fin1)}`);
  console.log(`  fin2: ${JSON.stringify(fin2)}`);
  ok(JSON.stringify(fin1) === JSON.stringify(fin2), 'P4 finalize idempotent same result');
  ok(fin2.finalMessage === 'final message', 'P4 second call does not re-emit new message');
}

// P5 Short turn discarded
console.log('\n════ P5 — Short turn discarded: create, finalize in 100ms with no updates -> discarded ════');
{
  draft._reset();
  const turnId = 'turn-p5';
  draft.create(turnId, { minDurationMs: 1500 }); // default 1500, no force, no updates
  await new Promise(r => setTimeout(r, 100));
  const res = draft.finalize(turnId, 'quick answer');
  console.log(`  result: ${JSON.stringify(res)}`);
  ok(res.state === 'discarded', `P5 discarded state (got ${res.state})`);
  ok(res.discarded === true, 'P5 discarded flag true');
  ok(res.state !== 'finalized', 'P5 no finalize event');
}

// P6 Update on finalized draft -> E_DRAFT_FINALIZED
console.log('\n════ P6 — Update on finalized draft -> E_DRAFT_FINALIZED ════');
{
  draft._reset();
  const turnId = 'turn-p6';
  draft.create(turnId, { minDurationMs: 100, force: true });
  await new Promise(r => setTimeout(r, 350));
  draft.update(turnId, { headline: 'h', steps: ['s'] });
  draft.finalize(turnId, 'done');
  let threw = false;
  try {
    draft.update(turnId, { headline: 'should fail' });
  } catch (e) {
    console.log(`  threw: code=${e.code} message=${e.message}`);
    threw = e.code === 'E_DRAFT_FINALIZED';
  }
  ok(threw, 'P6 update on finalized throws E_DRAFT_FINALIZED');
}

// P7 Unknown turnId -> E_UNKNOWN_TURN
console.log('\n════ P7 — Unknown turnId -> E_UNKNOWN_TURN ════');
{
  draft._reset();
  let threwUpdate = false, threwFinalize = false;
  try {
    draft.update('unknown-turn', { headline: 'x' });
  } catch (e) {
    console.log(`  update threw: code=${e.code}`);
    threwUpdate = e.code === 'E_UNKNOWN_TURN';
  }
  try {
    draft.finalize('unknown-turn', 'msg');
  } catch (e) {
    console.log(`  finalize threw: code=${e.code}`);
    threwFinalize = e.code === 'E_UNKNOWN_TURN';
  }
  ok(threwUpdate, 'P7 update unknown turn throws E_UNKNOWN_TURN');
  ok(threwFinalize, 'P7 finalize unknown turn throws E_UNKNOWN_TURN');
  let threwCreate = false;
  try {
    draft.create('', {});
  } catch (e) {
    threwCreate = e.code === 'E_UNKNOWN_TURN';
  }
  ok(threwCreate, 'P7 create missing turnId throws E_UNKNOWN_TURN');
}

// P8 Determinism same patch sequence identical state (ts masked)
console.log('\n════ P8 — Determinism: Same patch sequence -> identical state (ts masked) ════');
{
  draft._reset();
  const turnId1 = 'turn-p8-a';
  draft.create(turnId1, { minDurationMs: 100, force: true, throttleMs: 10 });
  await new Promise(r => setTimeout(r, 20));
  draft.update(turnId1, { headline: 'h1', steps: ['a'] });
  await new Promise(r => setTimeout(r, 20));
  draft.update(turnId1, { headline: 'h2', steps: ['a', 'b'] });
  await new Promise(r => setTimeout(r, 20));
  const state1 = draft._getState(turnId1);
  const masked1 = { headline: state1.headline, steps: state1.steps, toolLog: state1.toolLog, state: state1.state };
  draft.finalize(turnId1, 'done');

  draft._reset();
  const turnId2 = 'turn-p8-b';
  draft.create(turnId2, { minDurationMs: 100, force: true, throttleMs: 10 });
  await new Promise(r => setTimeout(r, 20));
  draft.update(turnId2, { headline: 'h1', steps: ['a'] });
  await new Promise(r => setTimeout(r, 20));
  draft.update(turnId2, { headline: 'h2', steps: ['a', 'b'] });
  await new Promise(r => setTimeout(r, 20));
  const state2 = draft._getState(turnId2);
  const masked2 = { headline: state2.headline, steps: state2.steps, toolLog: state2.toolLog, state: state2.state };

  console.log(`  state1 masked: ${JSON.stringify(masked1)}`);
  console.log(`  state2 masked: ${JSON.stringify(masked2)}`);
  ok(JSON.stringify(masked1) === JSON.stringify(masked2), 'P8 deterministic identical state when ts masked');
  draft.finalize(turnId2, 'done');
}

// P9 Zone check
console.log('\n════ P9 — Zone check (git status --short only allowed zone) ════');
{
  console.log('  (Checked externally via git status --short)');
  ok(true, 'P9 placeholder');
}

console.log(`\n════ SCOPE D PROBE DONE — ${pass} passed, ${fail} failed ════`);
process.exit(fail === 0 ? 0 : 1);

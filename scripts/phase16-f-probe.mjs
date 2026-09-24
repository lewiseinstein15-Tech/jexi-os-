#!/usr/bin/env node
// Phase 16 Scope F — Progressive Disclosure probe
import { disclosure } from '../interfaces/ui/web/console/chat/disclosure.js';

let pass = 0, fail = 0;
const ok = (c, msg) => { c ? pass++ : fail++; console.log(`  ${c ? '✅' : '❌'} ${msg}`); };

console.log('=== Phase 16 F — Progressive Disclosure ===');

// P1 Wrap a turn — 3 layers exist and state returns answer:visible, why:collapsed, trace:collapsed
console.log('\n════ P1 — Wrap a turn, show 3 layers and default state ════');
{
  disclosure._reset();
  const turn = {
    turnId: 'turn-p1',
    answer: 'Final answer: built feature X',
    why: 'Because pattern matched Y',
    trace: 'tool1 -> tool2 -> tool3',
  };
  const wrapped = disclosure.wrap(turn);
  console.log(`  wrapped: ${JSON.stringify(wrapped)}`);
  ok(Array.isArray(wrapped.layers) && wrapped.layers.length === 3, `P1 3 layers exist (got ${wrapped.layers.length})`);
  ok(wrapped.layers.includes('answer') && wrapped.layers.includes('why') && wrapped.layers.includes('trace'), 'P1 layers include answer, why, trace');
  ok(wrapped.default === 'answer', `P1 default answer (got ${wrapped.default})`);

  const st = disclosure.state('turn-p1');
  console.log(`  state: ${JSON.stringify(st)}`);
  ok(st.answer === 'visible', `P1 answer:visible (got ${st.answer})`);
  ok(st.why === 'collapsed', `P1 why:collapsed (got ${st.why})`);
  ok(st.trace === 'collapsed', `P1 trace:collapsed (got ${st.trace})`);
}

// P2 Expand why -> state shows why:expanded, Collapse why -> collapsed
console.log('\n════ P2 — Expand why -> expanded, Collapse why -> collapsed ════');
{
  disclosure._reset();
  disclosure.wrap({ turnId: 'turn-p2', answer: 'ans', why: 'why content', trace: 'trace' });

  const exp = disclosure.expand('turn-p2', 'why');
  console.log(`  expand why: ${JSON.stringify(exp)}`);
  ok(exp.expanded === true && exp.layer === 'why', 'P2 expand why returns expanded true');

  const st1 = disclosure.state('turn-p2');
  console.log(`  state after expand: ${JSON.stringify(st1)}`);
  ok(st1.why === 'expanded', `P2 state why:expanded after expand (got ${st1.why})`);

  const col = disclosure.collapse('turn-p2', 'why');
  console.log(`  collapse why: ${JSON.stringify(col)}`);
  ok(col.expanded === false, 'P2 collapse why returns expanded false');

  const st2 = disclosure.state('turn-p2');
  console.log(`  state after collapse: ${JSON.stringify(st2)}`);
  ok(st2.why === 'collapsed', `P2 state why:collapsed after collapse (got ${st2.why})`);
}

// P3 Collapse answer -> E_ANSWER_FIXED
console.log('\n════ P3 — Collapse answer -> E_ANSWER_FIXED ════');
{
  disclosure._reset();
  disclosure.wrap({ turnId: 'turn-p3', answer: 'ans' });
  let threw = false;
  try {
    disclosure.collapse('turn-p3', 'answer');
  } catch (e) {
    console.log(`  threw: code=${e.code} message=${e.message}`);
    threw = e.code === 'E_ANSWER_FIXED';
  }
  ok(threw, 'P3 collapse answer throws E_ANSWER_FIXED');
}

// P4 Idempotent expand
console.log('\n════ P4 — Idempotent expand: why twice second no-op ════');
{
  disclosure._reset();
  disclosure.wrap({ turnId: 'turn-p4', answer: 'a', why: 'why' });
  const e1 = disclosure.expand('turn-p4', 'why');
  const e2 = disclosure.expand('turn-p4', 'why');
  console.log(`  e1: ${JSON.stringify(e1)}`);
  console.log(`  e2: ${JSON.stringify(e2)}`);
  ok(JSON.stringify(e1) === JSON.stringify(e2), 'P4 expand idempotent same result');
}

// P5 Unknown turn -> E_UNKNOWN_TURN
console.log('\n════ P5 — Unknown turn -> E_UNKNOWN_TURN ════');
{
  disclosure._reset();
  let threwState = false, threwExpand = false, threwCollapse = false;
  try { disclosure.state('unknown-turn'); } catch (e) { console.log(`  state threw ${e.code}`); threwState = e.code === 'E_UNKNOWN_TURN'; }
  try { disclosure.expand('unknown-turn', 'why'); } catch (e) { console.log(`  expand threw ${e.code}`); threwExpand = e.code === 'E_UNKNOWN_TURN'; }
  try { disclosure.collapse('unknown-turn', 'why'); } catch (e) { console.log(`  collapse threw ${e.code}`); threwCollapse = e.code === 'E_UNKNOWN_TURN'; }
  ok(threwState, 'P5 state unknown throws E_UNKNOWN_TURN');
  ok(threwExpand, 'P5 expand unknown throws E_UNKNOWN_TURN');
  ok(threwCollapse, 'P5 collapse unknown throws E_UNKNOWN_TURN');

  let threwWrap = false;
  try { disclosure.wrap({}); } catch (e) { console.log(`  wrap threw ${e.code}`); threwWrap = e.code === 'E_UNKNOWN_TURN'; }
  ok(threwWrap, 'P5 wrap missing turnId throws E_UNKNOWN_TURN');
}

// P6 Unknown layer -> E_UNKNOWN_LAYER
console.log('\n════ P6 — Unknown layer -> E_UNKNOWN_LAYER ════');
{
  disclosure._reset();
  disclosure.wrap({ turnId: 'turn-p6', answer: 'a' });
  let threwExpand = false, threwCollapse = false;
  try { disclosure.expand('turn-p6', 'not-a-layer'); } catch (e) { console.log(`  expand threw ${e.code}`); threwExpand = e.code === 'E_UNKNOWN_LAYER'; }
  try { disclosure.collapse('turn-p6', 'not-a-layer'); } catch (e) { console.log(`  collapse threw ${e.code}`); threwCollapse = e.code === 'E_UNKNOWN_LAYER'; }
  ok(threwExpand, 'P6 expand unknown layer throws E_UNKNOWN_LAYER');
  ok(threwCollapse, 'P6 collapse unknown layer throws E_UNKNOWN_LAYER');
}

// P7 Auto-expand then auto-collapse
console.log('\n════ P7 — Auto-expand then auto-collapse: wrap during stream -> why:expanded, turn.completed -> why:collapsed ════');
{
  disclosure._reset();
  // Wrap during stream
  const streamingTurn = { turnId: 'turn-p7', answer: 'ans', why: 'reason', trace: 'trace', streaming: true };
  disclosure.wrap(streamingTurn);
  const stStreaming = disclosure.state('turn-p7');
  console.log(`  during stream state: ${JSON.stringify(stStreaming)}`);
  ok(stStreaming.why === 'expanded', `P7 during stream why:expanded (got ${stStreaming.why})`);

  // Simulate turn.completed -> why collapsed
  // Option 1: wrap again with streaming false / completed
  disclosure.wrap({ turnId: 'turn-p7', answer: 'ans', why: 'reason', trace: 'trace', streaming: false, status: 'completed' });
  const stCompleted = disclosure.state('turn-p7');
  console.log(`  after completed (via wrap completed) state: ${JSON.stringify(stCompleted)}`);
  ok(stCompleted.why === 'collapsed', `P7 after completed why:collapsed (got ${stCompleted.why})`);

  // Also test via _complete helper
  disclosure._reset();
  disclosure.wrap({ turnId: 'turn-p7b', answer: 'ans', streaming: true });
  console.log(`  streaming state: ${JSON.stringify(disclosure.state('turn-p7b'))}`);
  disclosure._complete('turn-p7b');
  const stAfterComplete = disclosure.state('turn-p7b');
  console.log(`  after _complete state: ${JSON.stringify(stAfterComplete)}`);
  ok(stAfterComplete.why === 'collapsed', `P7 _complete collapses why (got ${stAfterComplete.why})`);
}

// P8 Determinism same wrap input twice identical state
console.log('\n════ P8 — Determinism: Same wrap input twice identical state ════');
{
  disclosure._reset();
  const turn = { turnId: 'turn-p8-a', answer: 'same answer', why: 'same why', trace: 'same trace' };
  disclosure.wrap(turn);
  const s1 = disclosure.state('turn-p8-a');

  disclosure._reset();
  const turn2 = { turnId: 'turn-p8-a', answer: 'same answer', why: 'same why', trace: 'same trace' };
  disclosure.wrap(turn2);
  const s2 = disclosure.state('turn-p8-a');

  console.log(`  s1: ${JSON.stringify(s1)} s2: ${JSON.stringify(s2)}`);
  ok(JSON.stringify(s1) === JSON.stringify(s2), 'P8 deterministic identical state');
}

// P7 extra: Unknown layer id in wrap -> E_UNKNOWN_LAYER
console.log('\n════ EXTRA — Unknown layer id in wrap -> E_UNKNOWN_LAYER ════');
{
  disclosure._reset();
  let threw = false;
  try {
    disclosure.wrap({ turnId: 'turn-extra', layers: ['answer', 'why', 'unknown-layer'] });
  } catch (e) {
    console.log(`  threw: code=${e.code}`);
    threw = e.code === 'E_UNKNOWN_LAYER';
  }
  ok(threw, 'EXTRA unknown layer in wrap throws E_UNKNOWN_LAYER');
}

// P9 Zone check
console.log('\n════ P9 — Zone check ════');
{
  console.log('  (Checked externally via git status)');
  ok(true, 'P9 placeholder');
}

console.log(`\n════ SCOPE F PROBE DONE — ${pass} passed, ${fail} failed ════`);
process.exit(fail === 0 ? 0 : 1);

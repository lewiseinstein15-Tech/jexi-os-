#!/usr/bin/env node
// Phase 16 Scope J — Session Runtime probe
import { runtime } from '../interfaces/ui/web/console/chat/runtime.js';
import { router } from '../interfaces/ui/web/console/chat/router.js';
import { modes } from '../interfaces/ui/web/console/chat/modes.js';
import { approvals } from '../interfaces/ui/web/console/chat/approvals.js';
import { draft } from '../interfaces/ui/web/console/chat/progress-draft.js';

let pass = 0, fail = 0;
const ok = (c, msg) => { c ? pass++ : fail++; console.log(`  ${c ? '✅' : '❌'} ${msg}`); };
const j = (v) => JSON.stringify(v);

console.log('=== Phase 16 J — Session Runtime ===');

const collect = async (stream) => { const out = []; for await (const e of stream) out.push(e); return out; };
const types = (list) => list.map((e) => e.type);

function hardReset() {
  runtime._reset();
  router._reset();
  modes._reset();
  approvals._reset();
  draft._reset();
}

/** Agent that blocks on a caller-controlled gate between two tool calls. */
function gatedAgent(gate) {
  return () => (async function* agent() {
    yield { kind: 'tool', name: 'read_file', args: { path: '/tmp/a' }, destructive: false };
    await gate.p;
    yield { kind: 'tool', name: 'write_file', args: { path: '/tmp/b' }, destructive: false };
  })();
}
const makeGate = () => { let open; const p = new Promise((r) => { open = r; }); return { p, open }; };

// P1 attach -> idle. send('hello') -> turnId + stream: message.delta ... turn.completed.
//    State ends done.
console.log('\n════ P1 — attach idle; send streams message.delta … turn.completed; ends done ════');
{
  hardReset();
  const sess = 'sess-p1';
  const h = runtime.attach(sess);
  console.log(`  attach -> sessionId=${h.sessionId}, api=${j(Object.keys(h).filter((k) => !k.startsWith('_')))}`);
  console.log(`  state before send -> ${j(h.state())}`);
  ok(h.sessionId === sess, 'P1 handle carries sessionId');
  ok(typeof h.on === 'function' && typeof h.state === 'function' && typeof h.detach === 'function', 'P1 handle exposes on/state/detach');
  ok(h.state().status === 'idle', `P1 fresh session is idle (got ${h.state().status})`);

  const { turnId, stream } = runtime.send(sess, 'hello');
  console.log(`  send('hello') -> turnId=${turnId}`);
  ok(typeof turnId === 'string' && turnId.length > 0, 'P1 send returned a turnId');
  ok(stream && typeof stream[Symbol.asyncIterator] === 'function', 'P1 send returned an AsyncIterable stream');

  const events = await collect(stream);
  console.log(`  stream emitted ${events.length} events: ${j(types(events))}`);
  ok(events[0].type === 'message.delta', `P1 first event is message.delta (got ${events[0].type})`);
  ok(events[0].event.payload.delta === 'hello', 'P1 message.delta carries the user text');
  ok(events[events.length - 1].type === 'turn.completed', `P1 last event is turn.completed (got ${events[events.length - 1].type})`);
  ok(events[events.length - 1].event.payload.status === 'ok', 'P1 turn.completed status ok');
  ok(events.every((e) => e.routed === true), 'P1 every streamed event routed:true');

  const after = h.state();
  console.log(`  state after stream -> ${j(after)}`);
  ok(after.status === 'done', `P1 state ends done (got ${after.status})`);
  ok(after.turnId === turnId, 'P1 state names the finished turn');
  ok(after.pending === 0, 'P1 no pending approvals');
  console.log(`  turnInfo -> ${j(runtime.turnInfo(sess, turnId))}`);
}

// P2 send() while a turn is active -> E_TURN_ACTIVE. First turn unaffected.
console.log('\n════ P2 — one active turn per session ════');
{
  hardReset();
  const sess = 'sess-p2';
  runtime.attach(sess);
  const gate = makeGate();
  runtime.configure(sess, { agent: gatedAgent(gate) });

  const first = runtime.send(sess, 'first');
  const stActive = runtime.state(sess);
  console.log(`  first send -> ${first.turnId}, state=${j(stActive)}`);
  ok(stActive.status === 'streaming' || stActive.status === 'opening', `P2 first turn active (${stActive.status})`);

  let code = null;
  try { runtime.send(sess, 'second'); } catch (e) { code = e.code; }
  console.log(`  second send threw code=${code}`);
  ok(code === 'E_TURN_ACTIVE', `P2 second send refused with E_TURN_ACTIVE (got ${code})`);

  // First turn must be untouched by the refused second send.
  gate.open();
  const events = await collect(first.stream);
  const st = runtime.state(sess);
  console.log(`  first turn completed -> ${j(types(events))} state=${st.status}`);
  ok(st.status === 'done', 'P2 first turn unaffected, completed normally');
  ok(events.filter((e) => e.type === 'message.delta').length === 1, 'P2 no second user message leaked in');

  // After it finishes, a new send is allowed.
  const third = runtime.send(sess, 'third');
  const ev3 = await collect(third.stream);
  console.log(`  post-completion send -> ${third.turnId} (${ev3.length} events)`);
  ok(ev3.length > 0, 'P2 send allowed again once the turn is terminal');
}

// P3 Every streamed event appears in router.history, in order, with surfaces.
console.log('\n════ P3 — stream cross-checks against router.history ════');
{
  hardReset();
  const sess = 'sess-p3';
  runtime.attach(sess);
  const { stream } = runtime.send(sess, 'hello');
  const events = await collect(stream);

  const hist = router.history(sess);
  console.log(`  stream  seqs -> ${j(events.map((e) => e.seq))}`);
  console.log(`  history seqs -> ${j(hist.map((h) => h.seq))}`);
  console.log(`  stream  types -> ${j(types(events))}`);
  console.log(`  history types -> ${j(hist.map((h) => h.type))}`);
  ok(hist.length === events.length, `P3 history has one entry per streamed event (${hist.length} vs ${events.length})`);
  ok(j(hist.map((h) => h.seq)) === j(events.map((e) => e.seq)), 'P3 identical seq order');
  ok(j(hist.map((h) => h.type)) === j(types(events)), 'P3 identical type order');
  ok(hist.every((h) => h.routed === true), 'P3 all history entries routed');
  ok(hist.every((h) => Array.isArray(h.surfaces) && h.surfaces.length > 0), 'P3 every history entry records surfaces');
  console.log(`  surfaces per event -> ${j(hist.map((h) => h.surfaces))}`);
  ok(j(hist.map((h) => h.surfaces)) === j(events.map((e) => e.surfaces)), 'P3 surfaces match between stream and history');
  // The runtime never bypasses the router: every event it emitted is in history.
  ok(events.every((e) => hist.some((h) => h.seq === e.seq && h.type === e.type)), 'P3 no runtime event bypassed the router');
}

// P4 approval path: tool requiring approval -> awaiting-approval.
//    approve('yes') -> turn continues and completes.
console.log('\n════ P4 — approval path through Scope G ════');
{
  hardReset();
  const sess = 'sess-p4';
  runtime.attach(sess);
  const agent = () => (async function* a() {
    yield { kind: 'narrate', type: 'decision', ctx: { build: 'the writer', pattern: 'existing', source: 'input:p4' } };
    yield { kind: 'tool', name: 'write_file', args: { path: '/tmp/x' }, destructive: true };
  })();
  const { turnId, stream } = runtime.send(sess, 'please write the file', { agent });

  const seen = [];
  let stateAtApproval = null;
  let approveResult = null;
  for await (const e of stream) {
    seen.push(e);
    if (e.type === 'approval.requested') {
      stateAtApproval = runtime.state(sess);
      console.log(`  approval.requested -> approvalId=${e.event.payload.approvalId} reason=${e.event.payload.reason}`);
      console.log(`  state at approval -> ${j(stateAtApproval)}`);
      approveResult = runtime.approve(sess, e.event.payload.approvalId, 'yes');
      console.log(`  approve('yes') -> ${j(approveResult)}`);
    }
  }

  ok(!!stateAtApproval, 'P4 runtime reached an approval request');
  ok(stateAtApproval.status === 'awaiting-approval', `P4 status was awaiting-approval (got ${stateAtApproval.status})`);
  ok(stateAtApproval.pending === 1, `P4 one pending approval reported (got ${stateAtApproval.pending})`);
  ok(approveResult && approveResult.accepted === true, 'P4 approve returned accepted:true');
  console.log(`  full sequence -> ${j(types(seen))}`);
  ok(types(seen).includes('approval.resolved'), 'P4 approval.resolved emitted after the decision');
  const resolved = seen.find((e) => e.type === 'approval.resolved');
  ok(resolved.event.payload.decision === 'approved', 'P4 decision recorded as approved');
  ok(types(seen).includes('tool.started') && types(seen).includes('tool.completed'), 'P4 tool ran after approval');
  ok(seen[seen.length - 1].type === 'turn.completed' && seen[seen.length - 1].event.payload.status === 'ok', 'P4 turn completed ok');
  ok(runtime.state(sess).status === 'done', 'P4 state done after approval path');

  // Denial path: named error, turn recorded as failed — not a silent pass.
  hardReset();
  const s2 = 'sess-p4-deny';
  runtime.attach(s2);
  const denyAgent = () => (async function* a() {
    yield { kind: 'tool', name: 'delete_file', args: { path: '/tmp/y' }, destructive: true };
  })();
  const denied = runtime.send(s2, 'delete it', { agent: denyAgent });
  const dEvents = [];
  for await (const e of denied.stream) {
    dEvents.push(e);
    if (e.type === 'approval.requested') runtime.approve(s2, e.event.payload.approvalId, 'no');
  }
  const tInfo = runtime.turnInfo(s2, denied.turnId);
  console.log(`  denial sequence -> ${j(types(dEvents))}`);
  console.log(`  denial turnInfo -> status=${tInfo.status} error=${j(tInfo.error)}`);
  ok(tInfo.status === 'failed', `P4 denial puts the turn in failed (got ${tInfo.status})`);
  ok(tInfo.error && tInfo.error.code === 'E_APPROVAL_DENIED', 'P4 denial recorded with the named error');
  ok(types(dEvents).includes('tool.failed'), 'P4 denial produced a visible tool.failed row');

  // Unknown approval id -> named error, not a silent no-op.
  let acode = null;
  try { runtime.approve(s2, 'appr_does_not_exist', 'yes'); } catch (e) { acode = e.code; }
  console.log(`  approve(unknown id) threw code=${acode}`);
  ok(acode === 'E_UNKNOWN_APPROVAL', `P4 unknown approvalId -> E_UNKNOWN_APPROVAL (got ${acode})`);
}

// P5 mode switch mid-turn -> plan; write-class event routed refused:true.
//    Earlier rows unchanged.
console.log('\n════ P5 — mid-turn mode switch affects only future events ════');
{
  hardReset();
  const sess = 'sess-p5';
  runtime.attach(sess);
  const gate = makeGate();
  runtime.configure(sess, { agent: gatedAgent(gate) });
  runtime.mode(sess, { interactionMode: 'act', displayMode: 'compact' });

  const { turnId, stream } = runtime.send(sess, 'do both');
  const seen = [];
  let beforeSnapshot = null;
  let switchResult = null;
  let opened = false;

  for await (const e of stream) {
    seen.push(e);
    if (e.type === 'tool.completed' && !opened) {
      // Read-class tool finished; snapshot every row rendered so far.
      beforeSnapshot = j(seen.map((x) => ({ seq: x.seq, type: x.type, rowOverride: x.modes && x.modes.rowOverride })));
      switchResult = runtime.mode(sess, { interactionMode: 'plan' });
      console.log(`  switched mid-turn -> ${j(switchResult)}`);
      gate.open();
      opened = true;
    }
  }

  console.log(`  sequence -> ${j(seen.map((e) => `${e.type}${e.refused ? '(refused)' : ''}`))}`);
  const writeStarted = seen.filter((e) => e.type === 'tool.started').pop();
  console.log(`  write tool.started -> refused=${writeStarted.refused} modes=${j(writeStarted.modes)}`);
  ok(writeStarted.refused === true, 'P5 write-class event routed with refused:true');
  ok(writeStarted.modes.allowed === false, 'P5 Scope H verdict allowed:false');
  ok(writeStarted.modes.reason === 'E_PLAN_MODE_READONLY', `P5 reason E_PLAN_MODE_READONLY (got ${writeStarted.modes.reason})`);
  ok(writeStarted.modes.interactionMode === 'plan', 'P5 the switch reached Scope H');

  const readStarted = seen.find((e) => e.type === 'tool.started');
  console.log(`  earlier read tool.started -> refused=${readStarted.refused} interactionMode=${readStarted.modes.interactionMode}`);
  ok(readStarted.refused === false && readStarted.modes.interactionMode === 'act', 'P5 the earlier event kept its original verdict');

  const afterSnapshot = j(seen.slice(0, seen.indexOf(writeStarted)).map((x) => ({ seq: x.seq, type: x.type, rowOverride: x.modes && x.modes.rowOverride })));
  ok(beforeSnapshot === afterSnapshot, 'P5 rows rendered before the switch are byte-identical afterwards');

  const info = runtime.turnInfo(sess, turnId);
  console.log(`  refusals -> ${j(info.refusals)}`);
  ok(info.refusals.length === 1 && info.refusals[0].tool === 'write_file', 'P5 refusal recorded on the turn');
  ok(types(seen).includes('tool.failed'), 'P5 the refused tool reported tool.failed, not a fake success');
}

// P6 attach idempotence: same handle, no duplicate subscribers.
console.log('\n════ P6 — attach is idempotent ════');
{
  hardReset();
  const sess = 'sess-p6';
  const h1 = runtime.attach(sess);
  const subsAfterFirst = router.subscriberCount(sess);
  const h2 = runtime.attach(sess);
  const subsAfterSecond = router.subscriberCount(sess);
  const h3 = runtime.attach(sess, { agentId: 'should-be-ignored' });

  console.log(`  h1 === h2 -> ${h1 === h2}`);
  console.log(`  h1 === h3 -> ${h1 === h3}`);
  console.log(`  router subscribers after 1st=${j(subsAfterFirst)} after 2nd=${j(subsAfterSecond)}`);
  ok(h1 === h2, 'P6 second attach returned the identical handle object');
  ok(h1 === h3, 'P6 third attach (different opts) also returned the same handle');
  ok(subsAfterFirst.total === subsAfterSecond.total, `P6 no duplicate router subscriber (${subsAfterFirst.total} -> ${subsAfterSecond.total})`);
  ok(runtime.isAttached(sess) === true, 'P6 session reports attached');

  // One handle means one shared view of state.
  const { stream } = runtime.send(sess, 'hello');
  await collect(stream);
  ok(j(h1.state()) === j(h2.state()), 'P6 both handles report identical state');

  h1.detach();
  ok(runtime.isAttached(sess) === false, 'P6 detach clears attachment');
  let dcode = null;
  try { h1.state(); } catch (e) { dcode = e.code; }
  console.log(`  state() after detach threw code=${dcode}`);
  ok(dcode === 'E_DETACHED', `P6 detached handle refuses commands with E_DETACHED (got ${dcode})`);
  const h4 = runtime.attach(sess);
  ok(h4 !== h1 && runtime.isAttached(sess), 'P6 re-attach after detach yields a live handle');
  console.log(`  subscribers after re-attach -> ${j(router.subscriberCount(sess))}`);
  ok(router.subscriberCount(sess).total === 1, 'P6 re-attach did not stack subscribers');
}

// P7 detach mid-turn: turn continues, buffered. Re-attach + replay returns all.
console.log('\n════ P7 — detach mid-turn keeps the turn alive and replayable ════');
{
  hardReset();
  const sess = 'sess-p7';
  const h = runtime.attach(sess);
  const gate = makeGate();
  runtime.configure(sess, { agent: gatedAgent(gate) });

  const { turnId, stream } = runtime.send(sess, 'long job');
  // Pull the first event, then walk away mid-turn.
  const it = stream[Symbol.asyncIterator]();
  const firstEv = await it.next();
  console.log(`  consumed 1 event (${firstEv.value.type}), now detaching`);

  const d = h.detach();
  console.log(`  detach -> ${j(d)}`);
  ok(d.detached === true, 'P7 detach succeeded');
  ok(d.activeTurnId === turnId, 'P7 detach reports the still-active turn');
  ok(runtime.state(sess).status !== 'done', `P7 turn NOT closed by detach (status=${runtime.state(sess).status})`);

  // The turn keeps running with nobody attached.
  gate.open();
  const settled = await runtime.settle(sess);
  console.log(`  turn settled while detached -> ${settled}`);
  ok(settled === 'done', 'P7 detached turn ran to completion');

  const h2 = runtime.attach(sess);
  const replayed = runtime.replay(sess, turnId);
  console.log(`  replay(${turnId}) -> ${replayed.length} events: ${j(types(replayed))}`);
  ok(replayed.length >= 4, `P7 replay returned the full sequence (${replayed.length} events)`);
  ok(replayed[0].type === 'message.delta', 'P7 replay starts with the user message');
  ok(replayed[replayed.length - 1].type === 'turn.completed', 'P7 replay ends with turn.completed');
  ok(replayed.every((e) => e.routed === true), 'P7 every replayed event was routed');
  ok(replayed.every((e) => Array.isArray(e.deliveries) && e.deliveries.length > 0), 'P7 replayed events carry real surface delivery receipts');
  console.log(`  deliveries on first event -> ${j(replayed[0].deliveries.map((x) => x.surface))}`);

  // The abandoned iterator still drains the remainder — nothing was lost.
  const rest = [];
  for (;;) { const r = await it.next(); if (r.done) break; rest.push(r.value); }
  console.log(`  original iterator drained ${rest.length} more events after re-attach`);
  ok(rest.length === replayed.length - 1, 'P7 no events lost across detach/re-attach');

  let rcode = null;
  try { runtime.replay(sess, 'nope'); } catch (e) { rcode = e.code; }
  console.log(`  replay(unknown turn) threw code=${rcode}`);
  ok(rcode === 'E_UNKNOWN_TURN', `P7 unknown turn -> E_UNKNOWN_TURN (got ${rcode})`);
  ok(h2.sessionId === sess, 'P7 re-attached handle is usable');
}

// P8 turn history bound: 55 turns -> last 50 retained, oldest 5 evicted, logged.
console.log('\n════ P8 — turn history bounded at 50, eviction logged ════');
{
  hardReset();
  const sess = 'sess-p8';
  runtime.attach(sess);
  const TOTAL = 55;
  const ids = [];
  for (let i = 1; i <= TOTAL; i += 1) {
    const { turnId, stream } = runtime.send(sess, `ping ${i}`);
    await collect(stream);
    ids.push(turnId);
  }

  const retained = runtime.retainedTurns(sess);
  const ev = runtime.evictions(sess);
  console.log(`  turns run=${TOTAL} retained=${retained.length} evictions=${ev.length}`);
  console.log(`  first retained -> ${retained[0]}`);
  console.log(`  last  retained -> ${retained[retained.length - 1]}`);
  console.log(`  evicted -> ${j(ev.map((e) => e.turnId))}`);
  ok(retained.length === 50, `P8 exactly 50 turns retained (got ${retained.length})`);
  ok(ev.length === 5, `P8 exactly 5 evicted (got ${ev.length})`);
  ok(j(ev.map((e) => e.turnId)) === j(ids.slice(0, 5)), 'P8 the OLDEST 5 were evicted');
  ok(j(retained) === j(ids.slice(5)), 'P8 the newest 50 were retained');
  ok(ev.every((e) => e.reason === 'E_HISTORY_BOUND'), 'P8 every eviction names its reason');
  console.log(`  eviction log[0] -> ${j(ev[0])}`);
  ok(runtime.state(sess).evictions === 5, 'P8 eviction count visible in state()');

  // Evicted turns are gone; retained ones still replay.
  let ecode = null;
  try { runtime.replay(sess, ids[0]); } catch (e) { ecode = e.code; }
  console.log(`  replay(evicted) threw code=${ecode}`);
  ok(ecode === 'E_UNKNOWN_TURN', 'P8 evicted turn no longer replayable');
  ok(runtime.replay(sess, ids[54]).length > 0, 'P8 newest turn still replayable');
}

// P9 determinism: same userInput + same mode state -> byte-identical stream.
console.log('\n════ P9 — determinism ════');
{
  const sess = 'sess-p9';
  const runOnce = async () => {
    hardReset();
    runtime.attach(sess);
    runtime.mode(sess, { displayMode: 'compact', interactionMode: 'act' });
    const { turnId, stream } = runtime.send(sess, 'hello there');
    const events = await collect(stream);
    return { turnId, events };
  };

  const a = await runOnce();
  const b = await runOnce();
  console.log(`  run1 turnId=${a.turnId} events=${a.events.length}`);
  console.log(`  run2 turnId=${b.turnId} events=${b.events.length}`);
  console.log(`  run1 types -> ${j(types(a.events))}`);
  ok(a.turnId === b.turnId, 'P9 same turnId across runs');
  ok(j(a.events) === j(b.events), 'P9 byte-identical routed event stream across runs');
  ok(j(a.events.map((e) => e.event.ts)) === j(b.events.map((e) => e.event.ts)), 'P9 timestamps reproducible');
  ok(j(a.events.map((e) => e.surfaces)) === j(b.events.map((e) => e.surfaces)), 'P9 surface routing reproducible');

  // Different mode state must produce a different (but still deterministic) stream.
  hardReset();
  runtime.attach(sess);
  runtime.mode(sess, { displayMode: 'inline', interactionMode: 'act' });
  const { stream: s3 } = runtime.send(sess, 'hello there');
  const c = await collect(s3);
  console.log(`  inline-mode verbosity -> ${j(c.map((e) => e.modes && e.modes.rowOverride.verbosity))}`);
  ok(j(c) !== j(a.events), 'P9 a different mode state changes the stream');
  ok(c.every((e) => e.modes.rowOverride.verbosity === 'inline'), 'P9 inline mode applied to every row');
}

// P10 Failure paths: every refusal is a named error, the turn is recorded as
//     failed, and the draft is released so the next turn still works.
console.log('\n════ P10 — failure paths are named, recorded, non-sticky ════');
{
  hardReset();
  const sess = 'sess-p10';
  const h = runtime.attach(sess);
  const codeOf = (fn) => { try { fn(); return '(no throw)'; } catch (e) { return e.code; } };

  console.log(`  empty input=${codeOf(() => runtime.send(sess, ''))} non-string=${codeOf(() => runtime.send(sess, 42))}`);
  console.log(`  unknown command=${codeOf(() => h.on({ type: 'teleport' }))} null command=${codeOf(() => h.on(null))}`);
  console.log(`  bad sessionId=${codeOf(() => runtime.attach('bad id!'))} unknown mode=${codeOf(() => runtime.mode(sess, { displayMode: 'verbose' }))}`);
  ok(codeOf(() => runtime.send(sess, '')) === 'E_INVALID_INPUT', 'P10 empty input -> E_INVALID_INPUT');
  ok(codeOf(() => runtime.send(sess, 42)) === 'E_INVALID_INPUT', 'P10 non-string input -> E_INVALID_INPUT');
  ok(codeOf(() => h.on({ type: 'teleport' })) === 'E_UNKNOWN_COMMAND', 'P10 unknown command -> E_UNKNOWN_COMMAND');
  ok(codeOf(() => h.on(null)) === 'E_UNKNOWN_COMMAND', 'P10 null command -> E_UNKNOWN_COMMAND');
  ok(codeOf(() => runtime.attach('bad id!')) === 'E_INVALID_SESSION', 'P10 malformed sessionId -> E_INVALID_SESSION');
  ok(codeOf(() => runtime.mode(sess, { displayMode: 'verbose' })) === 'E_UNKNOWN_MODE', 'P10 unknown mode -> E_UNKNOWN_MODE (Scope H)');

  const run = async (agent) => {
    hardReset();
    runtime.attach(sess);
    const { turnId, stream } = runtime.send(sess, 'x', { agent });
    const events = await collect(stream);
    return { turnId, events, info: runtime.turnInfo(sess, turnId), state: runtime.state(sess) };
  };

  const threw = await run(() => (async function* a() { yield { kind: 'text', delta: 'hi' }; throw new Error('agent exploded'); })());
  console.log(`  throwing agent -> status=${threw.state.status} last=${threw.events[threw.events.length - 1].type} error=${j(threw.info.error)}`);
  ok(threw.state.status === 'failed' && threw.info.error.code === 'E_TURN_ERROR', 'P10 a throwing agent fails the turn with a named error');
  ok(threw.events[threw.events.length - 1].type === 'turn.completed', 'P10 a failed turn still closes with turn.completed');
  ok(threw.events[threw.events.length - 1].event.payload.status === 'fail', 'P10 turn.completed carries status fail');

  const unknownIntent = await run(() => (async function* a() { yield { kind: 'wobble' }; })());
  console.log(`  unknown intent -> status=${unknownIntent.state.status} error=${j(unknownIntent.info.error)}`);
  ok(unknownIntent.info.error.code === 'E_UNKNOWN_INTENT', 'P10 unknown intent kind -> E_UNKNOWN_INTENT');

  const failIntent = await run(() => (async function* a() { yield { kind: 'fail', code: 'E_NOPE', message: 'gave up' }; })());
  console.log(`  fail intent    -> status=${failIntent.state.status} tc.status=${failIntent.events[failIntent.events.length - 1].event.payload.status}`);
  ok(failIntent.state.status === 'failed', 'P10 an explicit fail intent fails the turn');
  ok(failIntent.info.error.code === 'E_NOPE', 'P10 the agent-supplied code is preserved');

  const badNarration = await run(() => (async function* a() { yield { kind: 'narrate', type: 'gibberish', ctx: { source: 'x' } }; })());
  console.log(`  bad narration  -> status=${badNarration.state.status} error=${j(badNarration.info.error)}`);
  ok(badNarration.info.error.code === 'E_UNKNOWN_NARRATION', 'P10 Scope B narration error propagates by name');

  // The failed turn must not leave Scope D's single global draft stuck.
  const { stream: nextStream } = runtime.send(sess, 'next turn');
  const nextEvents = await collect(nextStream);
  console.log(`  turn after failures -> events=${nextEvents.length} status=${runtime.state(sess).status}`);
  ok(nextEvents.length === 6 && runtime.state(sess).status === 'done', 'P10 the next turn runs normally after a failed one');

  // Detach is idempotent.
  const h2 = runtime.attach(sess);
  h2.detach();
  const second = h2.detach();
  console.log(`  detach twice -> ${j(second)}`);
  ok(second.alreadyDetached === true, 'P10 detaching twice is a safe no-op');
}

console.log(`\n════ SCOPE J PROBE DONE — ${pass} passed, ${fail} failed ════`);
process.exit(fail === 0 ? 0 : 1);

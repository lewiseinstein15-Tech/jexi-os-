#!/usr/bin/env node
// Phase 16 Scope I — Event Router probe
import { router } from '../interfaces/ui/web/console/chat/router.js';
import { modes } from '../interfaces/ui/web/console/chat/modes.js';
import { taxonomy } from '../runtime/events/chat/taxonomy.js';

let pass = 0, fail = 0;
const ok = (c, msg) => { c ? pass++ : fail++; console.log(`  ${c ? '✅' : '❌'} ${msg}`); };
const j = (v) => JSON.stringify(v);

console.log('=== Phase 16 I — Event Router ===');

// Build a taxonomy-valid event.
const ev = (type, sessionId, payload, extra = {}) => ({
  type, version: 1, ts: '2026-09-21T00:00:00.000Z', sessionId, agentId: 'agent-root', payload, ...extra,
});

// P1 Emit 5 mixed events to a fresh session.
//    Subscriber receives all 5, in order, once each. routed:true + surfaces.
console.log('\n════ P1 — 5 mixed events: all routed, in order, once each ════');
{
  router._reset();
  const sess = 'sess-p1';
  const seen = [];
  const unsub = router.subscribe(sess, (envelope) => seen.push(envelope));
  ok(typeof unsub === 'function', 'P1 subscribe returned an unsubscribe fn');

  const batch = [
    ev('message.delta', sess, { delta: 'hello', messageId: 'm1' }),
    ev('tool.started', sess, { toolCallId: 'tc1', toolName: 'read_file', args: { path: '/tmp/a' } }),
    ev('tool.completed', sess, { toolCallId: 'tc1', result: 'ok' }),
    ev('approval.requested', sess, { approvalId: 'ap1', reason: 'writeFile', options: ['yes', 'no'] }),
    ev('turn.completed', sess, { turnId: 'turn-p1', status: 'ok' }),
  ];

  const results = batch.map((e) => router.route(sess, e));
  for (const r of results) {
    console.log(`  route ${String(results.indexOf(r) + 1)} -> routed=${r.routed} surfaces=${j(r.surfaces)} turn=${r.turnId} seq=${r.seq}`);
  }
  ok(results.every((r) => r.routed === true), 'P1 all 5 routed:true');
  ok(j(results.map((r) => r.surfaces[0])) === j(['rows', 'rows', 'rows', 'rows', 'rows']), 'P1 rows claims every event');
  ok(results[3].surfaces.includes('approval') && results[0].surfaces.includes('draft'), 'P1 approval.requested -> approval surface; message.delta -> draft surface');

  console.log(`  subscriber received ${seen.length} envelopes`);
  ok(seen.length === 5, `P1 subscriber got all 5 (got ${seen.length})`);
  ok(j(seen.map((e) => e.seq)) === j([1, 2, 3, 4, 5]), `P1 receipt order preserved (${j(seen.map((e) => e.seq))})`);
  ok(j(seen.map((e) => e.event.type)) === j(['message.delta', 'tool.started', 'tool.completed', 'approval.requested', 'turn.completed']), 'P1 types in order');
  const seqs = seen.map((e) => e.seq);
  ok(new Set(seqs).size === seqs.length, 'P1 each event delivered exactly once (no double-render)');
  console.log(`  per-surface dispatch stats -> ${j(router.stats(sess))}`);
  ok(router.stats(sess).rows === 5, `P1 rows surface invoked once per event (got ${router.stats(sess).rows})`);

  const hist = router.history(sess);
  console.log(`  history entries=${hist.length} allRouted=${hist.every((h) => h.routed)}`);
  ok(hist.length === 5 && hist.every((h) => h.routed), 'P1 history records all 5 routed');
  unsub();
  ok(router.subscriberCount(sess).total === 0, 'P1 unsubscribe removed the handler');
}

// P2 Invalid event (missing required field) -> routed:false, E_INVALID_EVENT,
//    in history with the validation error. Other valid events still route.
console.log('\n════ P2 — invalid event -> E_INVALID_EVENT, logged, others still route ════');
{
  router._reset();
  const sess = 'sess-p2';
  const seen = [];
  router.subscribe(sess, (e) => seen.push(e));

  // message.delta requires payload.delta — omit it.
  const bad = ev('message.delta', sess, { messageId: 'm1' });
  const v = taxonomy.validate(bad);
  console.log(`  taxonomy.validate(bad) -> valid=${v.valid} errors=${j(v.errors)}`);

  const r = router.route(sess, bad);
  console.log(`  route(bad) -> ${j({ routed: r.routed, reason: r.reason, surfaces: r.surfaces })}`);
  ok(r.routed === false, 'P2 invalid event not routed');
  ok(r.reason === 'E_INVALID_EVENT', `P2 reason E_INVALID_EVENT (got ${r.reason})`);

  const hist = router.history(sess);
  console.log(`  history[0] -> ${j(hist[0])}`);
  ok(hist.length === 1 && hist[0].routed === false, 'P2 dropped event recorded in history');
  ok(hist[0].reason === 'E_INVALID_EVENT', 'P2 history carries the named reason');
  ok(Array.isArray(hist[0].errors) && hist[0].errors.some((e) => e.code === 'E_MISSING_PAYLOAD_FIELD'), 'P2 history carries the taxonomy validation error');

  // Subscriber must not see the dropped event.
  ok(seen.length === 0, `P2 dropped event not delivered to subscriber (got ${seen.length})`);
  ok(router.stats(sess).rows === 0, 'P2 no surface dispatch for a dropped event');

  // A valid event afterwards still routes.
  const good = router.route(sess, ev('message.delta', sess, { delta: 'still here', messageId: 'm2' }));
  console.log(`  route(good) -> routed=${good.routed} surfaces=${j(good.surfaces)}`);
  ok(good.routed === true, 'P2 valid event after the drop still routes');
  ok(seen.length === 1, 'P2 subscriber received only the valid event');
  const h2 = router.history(sess);
  ok(h2.length === 2 && h2[0].routed === false && h2[1].routed === true, 'P2 history shows drop then success, in order');
}

// P3 Unknown event type (valid shape, unmapped type) -> routed:false,
//    E_UNMAPPED_EVENT, visible in history.
console.log('\n════ P3 — unknown type -> E_UNMAPPED_EVENT (a gap, not a skip) ════');
{
  router._reset();
  const sess = 'sess-p3';
  router.subscribe(sess, () => {});

  const unknown = ev('telemetry.ping', sess, { metric: 'cpu', value: 0.4 });
  const v = taxonomy.validate(unknown);
  console.log(`  taxonomy.validate(unknown type) -> valid=${v.valid} codes=${j(v.errors.map((e) => e.code))}`);

  const r = router.route(sess, unknown);
  console.log(`  route(telemetry.ping) -> ${j({ routed: r.routed, reason: r.reason, errors: r.errors })}`);
  ok(r.routed === false, 'P3 unmapped type not routed');
  ok(r.reason === 'E_UNMAPPED_EVENT', `P3 reason E_UNMAPPED_EVENT (got ${r.reason})`);
  ok(r.reason !== 'E_INVALID_EVENT', 'P3 distinguished from E_INVALID_EVENT');

  const hist = router.history(sess);
  console.log(`  history -> ${j(hist)}`);
  ok(hist.length === 1 && hist[0].routed === false && hist[0].reason === 'E_UNMAPPED_EVENT', 'P3 unmapped type visible in history');
  ok(hist[0].type === 'telemetry.ping', 'P3 history names the offending type');

  // Every one of the 16 taxonomy types must have a surface claim — no gaps.
  const table = router.routingTable();
  const uncovered = taxonomy.list().filter((t) => !(table[t] && table[t].length));
  console.log(`  taxonomy types=${taxonomy.list().length} uncovered by routing table=${j(uncovered)}`);
  ok(uncovered.length === 0, 'P3 all 16 taxonomy types have at least one surface');

  // Dynamic proof: one valid event of EVERY taxonomy type actually routes.
  const sample = {
    'message.delta': { delta: 'hi', messageId: 'm1' },
    'thinking.delta': { delta: 'hmm', thinkingId: 'th1' },
    'plan.created': { planId: 'pl1', steps: [] },
    'plan.updated': { planId: 'pl1', steps: [] },
    'tool.started': { toolCallId: 'tc1', toolName: 'read_file' },
    'tool.progress': { toolCallId: 'tc1', progress: 0.5 },
    'tool.completed': { toolCallId: 'tc1' },
    'tool.failed': { toolCallId: 'tc1', error: 'nope' },
    'approval.requested': { approvalId: 'ap1', reason: 'writeFile' },
    'approval.resolved': { approvalId: 'ap1', decision: 'approved' },
    'artifact.created': { artifactId: 'ar1', path: '/tmp/a' },
    'agent.spawned': { agentId: 'ag1', role: 'reviewer' },
    'agent.completed': { agentId: 'ag1' },
    'turn.completed': { turnId: 'turn-x', status: 'ok' },
    'checkpoint.created': { checkpointId: 'cp1' },
    'narration.line': { narrationType: 'progress', text: 'working', source: 'tool:tc1' },
  };
  router._reset();
  const sess2 = 'sess-p3-all';
  router.subscribe(sess2, () => {});
  const all = taxonomy.list().map((t) => ({ type: t, res: router.route(sess2, ev(t, sess2, sample[t])) }));
  const unrouted = all.filter((a) => !a.res.routed).map((a) => `${a.type}:${a.res.reason}`);
  console.log(`  routed ${all.length}/16 taxonomy types; unrouted=${j(unrouted)}`);
  ok(all.length === 16 && unrouted.length === 0, 'P3 all 16 taxonomy types route successfully through route()');
  ok(all.every((a) => a.res.surfaces.includes('rows')), 'P3 every taxonomy type reaches the rows surface');
}

// P4 Plan mode active: write-class tool event routes routed:true but reaches
//    the rows surface as refused (allowed:false / E_PLAN_MODE_READONLY).
//    Read-class event routes normally.
console.log('\n════ P4 — plan mode: refused at the surface, not dropped ════');
{
  router._reset();
  const sess = 'sess-p4';
  modes.setInteractionMode(sess, 'plan');
  modes.setDisplayMode(sess, 'compact');
  console.log(`  modes.get(${sess}) -> ${j(modes.get(sess))}`);

  const seen = [];
  router.subscribe(sess, (e) => seen.push(e));

  const writeEv = ev('tool.started', sess, { toolCallId: 'tcw', toolName: 'write_file', args: { path: '/tmp/x' } });
  const rw = router.route(sess, writeEv);
  console.log(`  route(write_file) -> routed=${rw.routed} surfaces=${j(rw.surfaces)} refused=${rw.refused} modes=${j(rw.modes)}`);
  ok(rw.routed === true, 'P4 plan-mode write event STILL routes (routed:true)');
  ok(rw.refused === true, 'P4 flagged refused');
  ok(rw.modes.allowed === false, 'P4 modes.apply() verdict allowed:false');
  ok(rw.modes.reason === 'E_PLAN_MODE_READONLY', `P4 reason E_PLAN_MODE_READONLY (got ${rw.modes.reason})`);

  // What actually reached the rows surface.
  const rowsReceipt = seen[0].deliveries.find((d) => d.surface === 'rows');
  console.log(`  rows surface receipt -> ${j(rowsReceipt)}`);
  console.log(`  envelope.modes at rows surface -> allowed=${seen[0].modes.allowed} reason=${seen[0].modes.reason} verbosity=${seen[0].modes.rowOverride.verbosity}`);
  ok(!!rowsReceipt && rowsReceipt.ok === true, 'P4 rows surface received the refused event (dispatched, not dropped)');
  ok(rowsReceipt.rowType === 'tool-use', `P4 rows rendered it as tool-use (got ${rowsReceipt.rowType})`);
  ok(seen[0].modes.allowed === false && seen[0].modes.reason === 'E_PLAN_MODE_READONLY', 'P4 rows surface sees allowed:false + named reason');
  ok(seen[0].modes.rowOverride.verbosity === 'compact', 'P4 displayMode shaped the rowOverride passed to rows');

  const readEv = ev('tool.started', sess, { toolCallId: 'tcr', toolName: 'read_file', args: { path: '/tmp/x' } });
  const rr = router.route(sess, readEv);
  console.log(`  route(read_file)  -> routed=${rr.routed} allowed=${rr.modes.allowed} reason=${rr.modes.reason} surfaces=${j(rr.surfaces)}`);
  ok(rr.routed === true && rr.modes.allowed === true, 'P4 read-class event routes normally in plan mode');

  const hist = router.history(sess);
  console.log(`  history refused flags -> ${j(hist.map((h) => h.refused))}`);
  ok(hist.length === 2 && hist.every((h) => h.routed), 'P4 both events present in history');
  ok(hist[0].refused === true && hist[1].refused === false, 'P4 history distinguishes refused from allowed');

  modes.setInteractionMode(sess, 'act');
  const rAct = router.route(sess, ev('tool.started', sess, { toolCallId: 'tcw2', toolName: 'write_file', args: {} }));
  console.log(`  act mode write_file -> allowed=${rAct.modes.allowed}`);
  ok(rAct.modes.allowed === true, 'P4 switching to act unblocks writes through the router');
}

// P5 Ordering + no-double-render: 3 events, each seen exactly once in order,
//    rows surface invoked once per event.
console.log('\n════ P5 — ordering, exactly-once, no double-render ════');
{
  router._reset();
  const sess = 'sess-p5';
  const seen = [];
  router.subscribe(sess, (e) => seen.push(e));

  const batch = [
    ev('thinking.delta', sess, { delta: 'considering', thinkingId: 'th1' }),
    ev('tool.started', sess, { toolCallId: 'tc1', toolName: 'grep_search', args: { q: 'router' } }),
    ev('message.delta', sess, { delta: 'answer', messageId: 'm1' }),
  ];
  batch.forEach((e) => router.route(sess, e));

  console.log(`  subscriber seq order -> ${j(seen.map((e) => e.seq))}`);
  console.log(`  subscriber type order -> ${j(seen.map((e) => e.event.type))}`);
  ok(seen.length === 3, `P5 subscriber saw 3 events (got ${seen.length})`);
  ok(j(seen.map((e) => e.seq)) === j([1, 2, 3]), 'P5 order preserved');
  const counts = {};
  for (const e of seen) counts[e.seq] = (counts[e.seq] || 0) + 1;
  console.log(`  deliveries per seq -> ${j(counts)}`);
  ok(Object.values(counts).every((c) => c === 1), 'P5 each event delivered exactly once');

  const st = router.stats(sess);
  console.log(`  per-surface dispatch -> ${j(st)}`);
  ok(st.rows === 3, `P5 rows invoked once per event (got ${st.rows})`);
  ok(st['dual-pane'] === 3, `P5 dual-pane invoked once per event (got ${st['dual-pane']})`);
  ok(st.draft === 3, `P5 draft invoked once per event (got ${st.draft})`);
  ok(st.approval === 0 && st.narration === 0, 'P5 surfaces that cannot claim these events were not invoked');

  // A second dispatch cycle for the same event is a NEW event, not a re-render.
  router.route(sess, batch[0]);
  console.log(`  after re-emitting event 1 -> rows=${router.stats(sess).rows}, subscriber=${seen.length}`);
  ok(router.stats(sess).rows === 4 && seen.length === 4, 'P5 re-emit counts as a new dispatch (no dedupe of distinct receipts)');

  // Turn boundary: a completed turn is never reopened, so a late event for it
  // must not claim the draft surface.
  router._reset();
  const s2 = 'sess-p5-turns';
  const t1 = router.route(s2, ev('message.delta', s2, { delta: 'x', messageId: 'm1' }));
  const tc = router.route(s2, ev('turn.completed', s2, { turnId: 'explicit-1', status: 'ok' }));
  const late = router.route(s2, ev('tool.started', s2, { toolCallId: 'tc9', toolName: 'read_file', args: {}, turnId: t1.turnId }));
  console.log(`  turn1=${t1.turnId} completing=${tc.turnId}`);
  console.log(`  late event for ${late.turnId} -> surfaces=${j(late.surfaces)}`);
  ok(t1.turnId !== tc.turnId, 'P5 completing event named a different turnId than the derived one');
  ok(t1.surfaces.includes('draft'), 'P5 an open turn claims draft');
  ok(!late.surfaces.includes('draft'), 'P5 a late event for a COMPLETED turn does not claim draft');
  ok(late.surfaces.includes('rows') && late.surfaces.includes('dual-pane'), 'P5 the late event still reaches its other surfaces');
  const next = router.route(s2, ev('message.delta', s2, { delta: 'y', messageId: 'm2' }));
  console.log(`  next turn -> ${next.turnId} surfaces=${j(next.surfaces)}`);
  ok(next.surfaces.includes('draft'), 'P5 a genuinely new turn reclaims draft');
}

// P6 Queue + drain: 3 events before any subscriber -> queued;
//    subscribe; drain -> handler receives all 3 in order.
console.log('\n════ P6 — pre-subscriber events are queued, drain flushes in order ════');
{
  router._reset();
  const sess = 'sess-p6';

  const batch = [
    ev('message.delta', sess, { delta: 'one', messageId: 'm1' }),
    ev('tool.started', sess, { toolCallId: 'tc1', toolName: 'read_file', args: {} }),
    ev('turn.completed', sess, { turnId: 'turn-p6', status: 'ok' }),
  ];
  const results = batch.map((e) => router.route(sess, e));
  console.log(`  routed with zero subscribers -> ${j(results.map((r) => r.routed))}`);
  console.log(`  queued after 3 routes -> ${router.queued(sess)}`);
  ok(results.every((r) => r.routed === true), 'P6 events routed even with no subscriber');
  ok(router.queued(sess) === 3, `P6 all 3 queued, none lost (got ${router.queued(sess)})`);

  const seen = [];
  router.subscribe(sess, (e) => seen.push(e));
  ok(seen.length === 0, 'P6 subscribing does not auto-flush');

  const d = router.drain(sess);
  console.log(`  drain -> drained=${d.drained}`);
  console.log(`  handler received -> ${j(seen.map((e) => `${e.seq}:${e.event.type}`))}`);
  ok(d.drained === 3, `P6 drain flushed 3 (got ${d.drained})`);
  ok(seen.length === 3, `P6 handler received all 3 (got ${seen.length})`);
  ok(j(seen.map((e) => e.seq)) === j([1, 2, 3]), 'P6 drained in receipt order');
  ok(j(seen.map((e) => e.event.type)) === j(['message.delta', 'tool.started', 'turn.completed']), 'P6 drained types in order');
  ok(router.queued(sess) === 0, 'P6 queue empty after drain');

  const d2 = router.drain(sess);
  console.log(`  second drain -> drained=${d2.drained}, handler total=${seen.length}`);
  ok(d2.drained === 0 && seen.length === 3, 'P6 drain is not replayed — no double dispatch');

  // Later events go straight through, not via the queue.
  router.route(sess, ev('message.delta', sess, { delta: 'live', messageId: 'm2' }));
  ok(seen.length === 4 && router.queued(sess) === 0, 'P6 post-subscribe events deliver immediately');
}

// P7 Handler isolation: 2 subscribers, subscriber 2 throws.
//    Subscriber 1 still receives every event. Subscriber 2 disabled after
//    first throw, logged. Third event still reaches subscriber 1.
console.log('\n════ P7 — throwing handler isolated, others unaffected ════');
{
  router._reset();
  const sess = 'sess-p7';
  const got1 = [];
  const got2 = [];
  router.subscribe(sess, (e) => got1.push(e.seq));
  router.subscribe(sess, (e) => { got2.push(e.seq); throw new Error('boom in subscriber 2'); });

  router.route(sess, ev('message.delta', sess, { delta: 'first', messageId: 'm1' }));
  console.log(`  after event 1 -> sub1=${j(got1)} sub2=${j(got2)} counts=${j(router.subscriberCount(sess))}`);
  ok(got1.length === 1 && got2.length === 1, 'P7 event 1 reached both before the throw');
  ok(router.subscriberCount(sess).active === 1, `P7 throwing handler disabled (active=${router.subscriberCount(sess).active})`);
  ok(router.subscriberCount(sess).total === 2, 'P7 disabled handler retained for audit, not silently removed');

  router.route(sess, ev('message.delta', sess, { delta: 'second', messageId: 'm2' }));
  router.route(sess, ev('message.delta', sess, { delta: 'third', messageId: 'm3' }));
  console.log(`  after events 2,3 -> sub1=${j(got1)} sub2=${j(got2)}`);
  ok(j(got1) === j([1, 2, 3]), `P7 subscriber 1 received every event (${j(got1)})`);
  ok(j(got2) === j([1]), `P7 subscriber 2 received nothing after being disabled (${j(got2)})`);

  const log = router.handlerLog(sess);
  console.log(`  handlerLog -> ${j(log)}`);
  ok(log.length === 1, `P7 exactly one failure logged (got ${log.length})`);
  ok(log[0].subscriber === 'sub_2' && log[0].message.includes('boom'), 'P7 log names the thrower and the error');
  ok(log[0].seq === 1 && log[0].type === 'message.delta', 'P7 log pins the failing dispatch');

  // The failure must not have blocked surface dispatch either.
  console.log(`  surface stats despite handler failure -> ${j(router.stats(sess))}`);
  ok(router.stats(sess).rows === 3, 'P7 surface dispatch unaffected by handler failure');
  const hist = router.history(sess);
  ok(hist.length === 3 && hist.every((h) => h.routed), 'P7 all 3 events still recorded as routed');
}

// P8 Determinism: same event sequence twice -> identical routed output.
console.log('\n════ P8 — determinism: identical output for identical sequence ════');
{
  const sess = 'sess-p8';
  const batch = [
    ev('message.delta', sess, { delta: 'a', messageId: 'm1' }),
    ev('tool.started', sess, { toolCallId: 'tc1', toolName: 'write_file', args: { path: '/tmp/a' } }),
    ev('narration.line', sess, { narrationType: 'progress', text: 'working', source: 'tool:tc1' }),
    ev('approval.requested', sess, { approvalId: 'ap1', reason: 'writeFile', options: ['yes', 'no'] }),
    ev('turn.completed', sess, { turnId: 'turn-p8', status: 'ok' }),
  ];
  const pick = (r) => ({ routed: r.routed, surfaces: r.surfaces, event: r.event });

  const runOnce = () => {
    router._reset();
    modes._reset();
    modes.setDisplayMode(sess, 'compact');
    return batch.map((e) => pick(router.route(sess, e)));
  };

  const out1 = runOnce();
  const out2 = runOnce();
  console.log(`  run1 -> ${j(out1)}`);
  console.log(`  run2 -> ${j(out2)}`);
  ok(j(out1) === j(out2), 'P8 byte-equal {routed, surfaces, event} across runs');

  // Full result equality too (modes verdict + seq + turnId included).
  const runFull = () => {
    router._reset();
    modes._reset();
    modes.setDisplayMode(sess, 'compact');
    return batch.map((e) => router.route(sess, e));
  };
  ok(j(runFull()) === j(runFull()), 'P8 full route() result byte-equal across runs');

  // Delivery order and surface dispatch counts are reproducible as well.
  const runDelivery = () => {
    router._reset();
    modes._reset();
    const seen = [];
    router.subscribe(sess, (e) => seen.push({ seq: e.seq, type: e.event.type, surfaces: e.surfaces }));
    batch.forEach((e) => router.route(sess, e));
    return { seen, stats: router.stats(sess) };
  };
  const d1 = runDelivery();
  const d2 = runDelivery();
  console.log(`  delivery run1 -> ${j(d1)}`);
  ok(j(d1) === j(d2), 'P8 delivery order and per-surface counts reproducible');
}

console.log(`\n════ SCOPE I PROBE DONE — ${pass} passed, ${fail} failed ════`);
process.exit(fail === 0 ? 0 : 1);

#!/usr/bin/env node
// Phase 16 Scope O — Multi-Agent Chat View probe (P1–P8)
import { multiagent } from '../interfaces/ui/web/console/chat/multiagent.js';
import { runtime } from '../interfaces/ui/web/console/chat/runtime.js';
import { router } from '../interfaces/ui/web/console/chat/router.js';
import { modes } from '../interfaces/ui/web/console/chat/modes.js';
import { queue } from '../interfaces/ui/web/console/chat/queue.js';
import { steer } from '../interfaces/ui/web/console/chat/steer.js';
import { checkpoints } from '../interfaces/ui/web/console/chat/checkpoints.js';
import { approvals } from '../interfaces/ui/web/console/chat/approvals.js';
import { draft } from '../interfaces/ui/web/console/chat/progress-draft.js';

let pass = 0, fail = 0;
const ok = (c, msg) => { c ? pass++ : fail++; console.log(`  ${c ? '✅' : '❌'} ${msg}`); };
const j = (v) => JSON.stringify(v);

console.log('=== Phase 16 O — Multi-Agent Chat View ===');

const hardReset = () => {
  multiagent._reset(); runtime._reset(); router._reset(); modes._reset();
  queue._reset(); steer._reset(); checkpoints._reset(); approvals._reset(); draft._reset();
};

/** Feed a valid routed event with a chosen agentId + numeric ts. */
function feed(sess, type, payload, { agentId, ts } = {}) {
  const evt = { type, version: 1, ts, sessionId: sess, payload };
  if (agentId) evt.agentId = agentId;
  const r = router.route(sess, evt);
  if (!r.routed) throw new Error(`not routed: ${type} ${j(r.errors)}`);
  return r;
}

const threeAgents = (sess) => {
  runtime.attach(sess);
  feed(sess, 'message.delta', { delta: 'starting', messageId: 'm0' }, { ts: 10 });
  feed(sess, 'message.delta', { delta: 'worker A on it', messageId: 'm1' }, { agentId: 'agent-a', ts: 20 });
  feed(sess, 'message.delta', { delta: 'worker B on it', messageId: 'm2' }, { agentId: 'agent-b', ts: 30 });
  feed(sess, 'message.delta', { delta: 'A done', messageId: 'm3' }, { agentId: 'agent-a', ts: 40 });
  feed(sess, 'message.delta', { delta: 'B done', messageId: 'm4' }, { agentId: 'agent-b', ts: 50 });
  feed(sess, 'message.delta', { delta: 'wrapping up', messageId: 'm5' }, { ts: 60 });
};

// ─────────────────────────────────────────────────────────────────────────────
// P1 — split: 3 panes in first-appearance order, per-agent events, stable colors.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n════ P1 — split view ════');
{
  hardReset();
  const sess = 'sess-o1';
  threeAgents(sess);
  const v = multiagent.view(sess, 'split');
  console.log(`  agents -> ${j(v.agents.map((a) => ({ id: a.agentId, color: a.color, n: a.eventCount })))}`);
  console.log(`  layout panes -> ${j(v.layout.map((p) => ({ pane: p.paneId, agent: p.agentId, events: p.events.length })))}`);
  ok(v.layout.length === 3, `P1 three panes (got ${v.layout.length})`);
  ok(j(v.layout.map((p) => p.agentId)) === j(['primary', 'agent-a', 'agent-b']), 'P1 panes in first-appearance order');
  ok(v.layout[1].events.every((e) => e.agentId === 'agent-a'), 'P1 pane 2 holds only agent-a events');
  ok(v.layout[1].events.length === 2, `P1 agent-a pane has 2 events (got ${v.layout[1].events.length})`);
  ok(v.agents[0].agentId === 'primary' && v.agents[0].eventCount === 2, 'P1 primary pseudo-agent captures agentless events');
  const c1 = multiagent.colorFor('agent-a');
  ok(v.agents.find((a) => a.agentId === 'agent-a').color === c1, 'P1 color deterministic per agentId');
}

// ─────────────────────────────────────────────────────────────────────────────
// P2 — interleaved: one entry, per-event agentId+rail+indent0, stable rail.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n════ P2 — interleaved view ════');
{
  const sess = 'sess-o1';
  const v = multiagent.view(sess, 'interleaved');
  ok(v.layout.length === 1, 'P2 single layout entry');
  const evs = v.layout[0].events;
  ok(evs.length === 6, `P2 all 6 events present (got ${evs.length})`);
  ok(evs.every((e) => e.indent === 0), 'P2 every event indent 0');
  ok(evs.every((e) => typeof e.rail === 'string' && e.rail), 'P2 every event has a rail color');
  ok(evs.filter((e) => e.agentId === 'agent-a').every((e) => e.rail === multiagent.colorFor('agent-a')), 'P2 rail stable per agentId');
  console.log(`  interleaved rails -> ${j(evs.map((e) => [e.agentId, e.rail]))}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// P3 — nested: subagent events indent under parent's open tool call.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n════ P3 — nested view (timestamp containment) ════');
{
  hardReset();
  const sess = 'sess-o3';
  runtime.attach(sess);
  feed(sess, 'message.delta', { delta: 'parent spawn', messageId: 'p0' }, { ts: 90 });
  feed(sess, 'tool.started', { toolCallId: 'tc-spawn', toolName: 'task' }, { ts: 100 });
  feed(sess, 'message.delta', { delta: 'sub first', messageId: 's1' }, { agentId: 'agent-sub', ts: 110 });
  feed(sess, 'message.delta', { delta: 'sub last', messageId: 's2' }, { agentId: 'agent-sub', ts: 120 });
  feed(sess, 'tool.completed', { toolCallId: 'tc-spawn' }, { ts: 130 });
  feed(sess, 'message.delta', { delta: 'parent after', messageId: 'p1' }, { ts: 140 });

  const v = multiagent.view(sess, 'nested');
  const evs = v.layout[0].events;
  console.log('  nested (seq,type,agent,indent):');
  for (const e of evs) console.log(`    #${e.seq} ${e.type.padEnd(14)} ${e.agentId.padEnd(10)} indent=${e.indent}`);
  const sub = evs.filter((e) => e.agentId === 'agent-sub');
  const parent = evs.filter((e) => e.agentId === 'primary');
  ok(sub.length === 2 && sub.every((e) => e.indent === 1), 'P3 subagent events depth 1');
  ok(parent.every((e) => e.indent === 0), 'P3 parent events depth 0');
  // ordering: parent tool opens, sub first, sub last, parent completes
  const idx = (pred) => evs.findIndex(pred);
  ok(idx((e) => e.type === 'tool.started') < idx((e) => e.delta === 'sub first') &&
     idx((e) => e.delta === 'sub last') < idx((e) => e.type === 'tool.completed'), 'P3 containment order open→sub→close');
}

// ─────────────────────────────────────────────────────────────────────────────
// P4 — single: merged, no rails, no indents; default when <=1 agent.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n════ P4 — single view ════');
{
  const sess = 'sess-o3'; // still attached from P3
  const v = multiagent.view(sess, 'single');
  const evs = v.layout[0].events;
  ok(v.layout.length === 1, 'P4 single layout entry');
  ok(evs.every((e) => e.rail === null && e.indent === 0), 'P4 no rails, no indents');
  ok(evs.length === 6, 'P4 all events merged');

  hardReset();
  const solo = 'sess-o4';
  runtime.attach(solo);
  feed(solo, 'message.delta', { delta: 'only me', messageId: 'x' }, { ts: 1 });
  const dv = multiagent.view(solo); // no mode -> default
  console.log(`  solo agents -> ${j(dv.agents.map((a) => a.agentId))} mode=${dv.mode}`);
  ok(dv.agents.length === 1 && dv.mode === 'single', 'P4 defaults to single when agents<=1');
}

// ─────────────────────────────────────────────────────────────────────────────
// P5 — focus filters to agent (+descendants), clearFocus restores; log unchanged.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n════ P5 — focus / clearFocus ════');
{
  hardReset();
  const sess = 'sess-o5';
  runtime.attach(sess);
  feed(sess, 'tool.started', { toolCallId: 'tc1', toolName: 'task' }, { ts: 100 });
  feed(sess, 'message.delta', { delta: 'sub', messageId: 's' }, { agentId: 'agent-sub', ts: 110 });
  feed(sess, 'message.delta', { delta: 'sub2', messageId: 's2' }, { agentId: 'agent-sub', ts: 120 });
  feed(sess, 'tool.completed', { toolCallId: 'tc1' }, { ts: 130 });
  feed(sess, 'message.delta', { delta: 'parent', messageId: 'p' }, { ts: 140 });
  const lenBefore = router.history(sess).length;
  multiagent.focus(sess, 'agent-sub');
  const vf = multiagent.view(sess, 'split');
  const subPane = vf.layout.find((p) => p.agentId === 'agent-sub');
  const otherPanes = vf.layout.filter((p) => p.agentId !== 'agent-sub');
  ok(subPane && subPane.events.length === 2, 'P5 focus shows the agent events');
  ok(otherPanes.every((p) => p.events.length === 0), 'P5 other panes filtered out');
  multiagent.clearFocus(sess);
  const vc = multiagent.view(sess, 'split');
  ok(vc.layout.find((p) => p.agentId === 'primary').events.length > 0, 'P5 clearFocus returns all events');
  ok(router.history(sess).length === lenBefore, 'P5 view ops did not mutate the log');
  // nested focus includes descendants of the focused agent
  multiagent.focus(sess, 'primary');
  const vn = multiagent.view(sess, 'nested');
  const all = vn.layout[0].events;
  ok(all.some((e) => e.agentId === 'agent-sub'), 'P5 nested focus on parent includes descendant sub events');
  multiagent.clearFocus(sess);
}

// ─────────────────────────────────────────────────────────────────────────────
// P6 — errors.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n════ P6 — error codes ════');
{
  let c;
  c = null; try { multiagent.view('never-seen'); } catch (e) { c = e.code; }
  console.log(`  view unknown session -> ${c}`);
  ok(c === 'E_UNKNOWN_SESSION', 'P6 unknown sessionId -> E_UNKNOWN_SESSION');

  hardReset();
  const sess = 'sess-o6';
  runtime.attach(sess);
  c = null; try { multiagent.view(sess, 'hologram'); } catch (e) { c = e.code; }
  console.log(`  view unknown mode -> ${c}`);
  ok(c === 'E_UNKNOWN_MODE', 'P6 unknown mode -> E_UNKNOWN_MODE');

  c = null; try { multiagent.focus(sess, 'ghost'); } catch (e) { c = e.code; }
  console.log(`  focus unknown agent -> ${c}`);
  ok(c === 'E_UNKNOWN_AGENT', 'P6 unknown agentId -> E_UNKNOWN_AGENT');

  const empty = multiagent.view(sess, 'split');
  console.log(`  empty session view -> ${j(empty)}`);
  ok(j(empty.agents) === j([]) && j(empty.layout) === j([]), 'P6 empty session -> agents [], layout [] (not error)');
}

// ─────────────────────────────────────────────────────────────────────────────
// P7 — determinism.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n════ P7 — determinism ════');
{
  const runOnce = () => {
    hardReset();
    const sess = 'sess-o7';
    threeAgents(sess);
    return JSON.stringify({
      split: multiagent.view(sess, 'split'),
      interleaved: multiagent.view(sess, 'interleaved'),
      nested: multiagent.view(sess, 'nested'),
    });
  };
  const a = runOnce();
  const b = runOnce();
  ok(a === b, 'P7 byte-identical view output across two runs');
  console.log(`  identical=${a === b} length=${a.length}`);
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
    const hash = run("git log --format=%H --grep='^phase-16(O):' -1").trim();
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
  ok(changed.includes('ui/web/console/chat/multiagent.js'), 'P8 multiagent.js in changeset');
}

console.log(`\n=== Phase 16 O: ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);

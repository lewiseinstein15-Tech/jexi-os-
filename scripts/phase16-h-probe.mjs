#!/usr/bin/env node
// Phase 16 Scope H — Display + Interaction Modes probe
import { modes } from '../ui/web/console/chat/modes.js';
import { rows } from '../ui/web/console/chat/rows/index.js';

let pass = 0, fail = 0;
const ok = (c, msg) => { c ? pass++ : fail++; console.log(`  ${c ? '✅' : '❌'} ${msg}`); };
const j = (v) => JSON.stringify(v);

console.log('=== Phase 16 H — Display + Interaction Modes ===');

const toolStarted = (sessionId, toolName, args) => ({
  type: 'tool.started', version: 1, ts: '2026-09-21T00:00:00.000Z',
  sessionId, agentId: 'agent-root',
  payload: { toolCallId: `tc-${toolName}`, toolName, args },
});

const toolCompleted = (sessionId, toolName, result) => ({
  type: 'tool.completed', version: 1, ts: '2026-09-21T00:00:00.000Z',
  sessionId, agentId: 'agent-root',
  payload: { toolCallId: `tc-${toolName}`, toolName, result },
});

// P1 setDisplayMode(sess,'full') -> get returns full.
//    Apply a tool-use event -> rowOverride for full verbosity.
//    Switch to inline -> rowOverride for name only.
console.log('\n════ P1 — displayMode full -> get full; full verbosity then inline = name only ════');
{
  modes._reset();
  const sess = 'sess-p1';
  const ev = toolStarted(sess, 'write_file', { path: '/tmp/a.txt', content: 'hello world' });

  const set1 = modes.setDisplayMode(sess, 'full');
  console.log(`  setDisplayMode('full') -> ${j(set1)}`);
  const g = modes.get(sess);
  console.log(`  get(${sess}) -> ${j(g)}`);
  ok(set1.mode === 'full', `P1 setDisplayMode returned mode full (got ${set1.mode})`);
  ok(g.displayMode === 'full', `P1 get() returns full (got ${g.displayMode})`);

  const rFull = modes.apply('turn-p1', ev);
  console.log(`  apply(full) rowOverride -> ${j(rFull.rowOverride)}`);
  ok(rFull.rowOverride.verbosity === 'full', `P1 rowOverride verbosity full (got ${rFull.rowOverride.verbosity})`);
  ok(rFull.rowOverride.maxLines === null, 'P1 full = unlimited lines');
  ok(rFull.rowOverride.preview.includes('hello world'), 'P1 full preview carries full content');

  const set2 = modes.setDisplayMode(sess, 'inline');
  const rInline = modes.apply('turn-p1', ev);
  console.log(`  setDisplayMode('inline') -> ${j(set2)}`);
  console.log(`  apply(inline) rowOverride -> ${j(rInline.rowOverride)}`);
  ok(rInline.rowOverride.verbosity === 'inline', `P1 switched to inline (got ${rInline.rowOverride.verbosity})`);
  ok(rInline.rowOverride.preview === 'write_file', `P1 inline preview is name only (got ${j(rInline.rowOverride.preview)})`);
  ok(rInline.rowOverride.showBody === false && rInline.rowOverride.lineCount === 0, 'P1 inline hides body');

  // Verbosity ladder is real, not a label: minimal=1 line, compact=3, full=all.
  const ladder = {};
  const multiEv = toolCompleted(sess, 'read_file', 'l1\nl2\nl3\nl4\nl5');
  for (const m of ['minimal', 'compact', 'full']) {
    modes.setDisplayMode(sess, m);
    ladder[m] = modes.apply('turn-p1-ladder', multiEv).rowOverride;
  }
  console.log(`  ladder lineCounts (5-line source) -> ${j(Object.fromEntries(Object.entries(ladder).map(([k, v]) => [k, v.lineCount])))}`);
  ok(ladder.minimal.lineCount === 1, `P1 minimal = 1 line (got ${ladder.minimal.lineCount})`);
  ok(ladder.compact.lineCount === 3, `P1 compact = 3 lines (got ${ladder.compact.lineCount})`);
  ok(ladder.full.lineCount === 5, `P1 full = all 5 lines (got ${ladder.full.lineCount})`);
}

// P2 setInteractionMode(sess,'plan').
//    Apply write-tool event -> allowed:false, E_PLAN_MODE_READONLY.
//    Apply read-tool event -> allowed:true.
//    Switch to act -> write-tool event allowed:true.
console.log('\n════ P2 — plan locks write/edit/exec/bash; read passes; act allows all ════');
{
  modes._reset();
  const sess = 'sess-p2';
  const setIM = modes.setInteractionMode(sess, 'plan');
  console.log(`  setInteractionMode('plan') -> ${j(setIM)}`);
  console.log(`  get(${sess}) -> ${j(modes.get(sess))}`);
  ok(setIM.mode === 'plan', `P2 setInteractionMode returned plan (got ${setIM.mode})`);
  ok(modes.get(sess).interactionMode === 'plan', 'P2 get() returns plan');

  for (const tool of ['write_file', 'edit_file', 'exec_command', 'bash']) {
    const r = modes.apply('turn-p2', toolStarted(sess, tool, { path: '/tmp/x' }));
    console.log(`  plan + ${tool.padEnd(13)} -> allowed=${r.allowed} reason=${r.reason} class=${r.classification} rowOverride=${r.rowOverride ? 'present' : 'MISSING'}`);
    ok(r.allowed === false && r.reason === 'E_PLAN_MODE_READONLY', `P2 ${tool} refused with E_PLAN_MODE_READONLY`);
    // No silent bypass: the refusal is a named, RENDERABLE row — not dropped.
    ok(!!r.rowOverride && r.rowOverride.label === tool, `P2 ${tool} refusal still yields a renderable row`);
  }

  for (const tool of ['read_file', 'list_directory', 'grep_search']) {
    const r = modes.apply('turn-p2', toolStarted(sess, tool, { path: '/tmp/x' }));
    console.log(`  plan + ${tool.padEnd(13)} -> allowed=${r.allowed} class=${r.classification}`);
    ok(r.allowed === true, `P2 ${tool} allowed in plan mode`);
  }

  const prose = modes.apply('turn-p2', {
    type: 'message.delta', version: 1, ts: '2026-09-21T00:00:00.000Z',
    sessionId: sess, payload: { delta: 'planning…' },
  });
  console.log(`  plan + message.delta -> allowed=${prose.allowed} class=${prose.classification}`);
  ok(prose.allowed === true, 'P2 non-tool prose never gated');

  modes.setInteractionMode(sess, 'act');
  const rAct = modes.apply('turn-p2', toolStarted(sess, 'write_file', { path: '/tmp/x' }));
  console.log(`  act  + write_file    -> allowed=${rAct.allowed} reason=${rAct.reason ?? 'none'}`);
  ok(rAct.allowed === true, 'P2 act mode allows write_file');
}

// P3 Unknown mode -> E_UNKNOWN_MODE.
//    Unknown session on get -> returns defaults, no throw.
console.log('\n════ P3 — unknown mode -> E_UNKNOWN_MODE; unknown session -> defaults, no throw ════');
{
  modes._reset();
  const sess = 'sess-p3';

  const cases = [
    ['setDisplayMode', () => modes.setDisplayMode(sess, 'verbose')],
    ['setDisplayMode', () => modes.setDisplayMode(sess, 'FULL')],
    ['setInteractionMode', () => modes.setInteractionMode(sess, 'yolo')],
    ['setInteractionMode', () => modes.setInteractionMode(sess, null)],
  ];
  for (const [fn, run] of cases) {
    let code = null;
    try { run(); } catch (e) { code = e.code; }
    console.log(`  ${fn}(bad) threw code=${code}`);
    ok(code === 'E_UNKNOWN_MODE', `${fn} rejected with E_UNKNOWN_MODE (got ${code})`);
  }

  let threw = false;
  let g = null;
  try { g = modes.get('never-seen-session'); } catch { threw = true; }
  console.log(`  get('never-seen-session') -> ${j(g)} threw=${threw}`);
  ok(!threw, 'P3 unknown session did not throw');
  ok(g.displayMode === 'compact' && g.interactionMode === 'act', `P3 unknown session returned defaults (got ${j(g)})`);

  // Rejected switch must not corrupt existing state.
  modes.setDisplayMode(sess, 'full');
  try { modes.setDisplayMode(sess, 'nope'); } catch { /* expected */ }
  const after = modes.get(sess);
  console.log(`  state after rejected switch -> ${j(after)}`);
  ok(after.displayMode === 'full', 'P3 rejected switch left prior state intact');
}

// P4 Per-session isolation: two sessions with different modes,
//    both hold their own state, no bleed.
console.log('\n════ P4 — per-session isolation, no bleed ════');
{
  modes._reset();
  modes.setDisplayMode('sess-A', 'inline');
  modes.setInteractionMode('sess-A', 'plan');
  modes.setDisplayMode('sess-B', 'full');
  modes.setInteractionMode('sess-B', 'act');

  const gA = modes.get('sess-A');
  const gB = modes.get('sess-B');
  console.log(`  sess-A -> ${j(gA)}`);
  console.log(`  sess-B -> ${j(gB)}`);
  ok(gA.displayMode === 'inline' && gA.interactionMode === 'plan', 'P4 sess-A holds inline/plan');
  ok(gB.displayMode === 'full' && gB.interactionMode === 'act', 'P4 sess-B holds full/act');

  // Same tool event, two sessions -> different verdicts.
  const writeEvA = toolStarted('sess-A', 'write_file', { path: '/tmp/a' });
  const writeEvB = toolStarted('sess-B', 'write_file', { path: '/tmp/a' });
  const rA = modes.apply('turn-p4', writeEvA);
  const rB = modes.apply('turn-p4', writeEvB);
  console.log(`  sess-A write_file -> allowed=${rA.allowed} reason=${rA.reason} verbosity=${rA.rowOverride.verbosity}`);
  console.log(`  sess-B write_file -> allowed=${rB.allowed} verbosity=${rB.rowOverride.verbosity}`);
  ok(rA.allowed === false && rA.rowOverride.verbosity === 'inline', 'P4 sess-A verdict from its own modes');
  ok(rB.allowed === true && rB.rowOverride.verbosity === 'full', 'P4 sess-B verdict from its own modes');

  // Switching A must not move B.
  modes.setDisplayMode('sess-A', 'compact');
  modes.setInteractionMode('sess-A', 'act');
  const gB2 = modes.get('sess-B');
  console.log(`  after switching sess-A, sess-B -> ${j(gB2)}`);
  ok(gB2.displayMode === 'full' && gB2.interactionMode === 'act', 'P4 no bleed into sess-B');
  console.log(`  sessions() -> ${j(modes.sessions())}`);
}

// P5 Persistence: modes survive a simulated restart for the same sessionId.
console.log('\n════ P5 — modes survive a simulated restart ════');
{
  modes._reset();
  const sess = 'sess-p5';
  modes.setDisplayMode(sess, 'minimal');
  modes.setInteractionMode(sess, 'plan');
  const before = modes.get(sess);
  console.log(`  before restart -> ${j(before)}`);

  modes._simulateRestart();
  console.log('  _simulateRestart() — in-memory cache dropped, store retained');

  const after = modes.get(sess);
  console.log(`  after restart  -> ${j(after)}`);
  ok(after.displayMode === 'minimal' && after.interactionMode === 'plan', 'P5 modes rehydrated from store after restart');

  // Behaviour, not just the record, must survive.
  const r = modes.apply('turn-p5', toolStarted(sess, 'bash', { cmd: 'ls' }));
  console.log(`  after restart, plan+bash -> allowed=${r.allowed} reason=${r.reason} verbosity=${r.rowOverride.verbosity}`);
  ok(r.allowed === false && r.reason === 'E_PLAN_MODE_READONLY', 'P5 plan gating still enforced after restart');
  ok(r.rowOverride.verbosity === 'minimal', 'P5 display mode still applied after restart');

  // Other sessions untouched by the restart.
  modes.setDisplayMode('sess-p5-other', 'full');
  modes._simulateRestart();
  console.log(`  other session after 2nd restart -> ${j(modes.get('sess-p5-other'))}`);
  ok(modes.get('sess-p5-other').displayMode === 'full', 'P5 unrelated session also persisted');
}

// P6 Mid-turn switch: render 2 rows in compact, switch to full,
//    render 1 more -> first 2 unchanged, 3rd is full.
console.log('\n════ P6 — mid-turn switch is not retroactive ════');
{
  modes._reset();
  const sess = 'sess-p6';
  const turnId = 'turn-p6';
  modes.setDisplayMode(sess, 'compact');
  modes.setInteractionMode(sess, 'act');

  const multi = 'line-1: alpha\nline-2: bravo\nline-3: charlie\nline-4: delta\nline-5: echo';
  const r1 = modes.apply(turnId, toolCompleted(sess, 'read_file', multi));
  const r2 = modes.apply(turnId, toolCompleted(sess, 'read_file', multi));
  const snap1 = j(r1.rowOverride);
  const snap2 = j(r2.rowOverride);
  console.log(`  row1 compact -> lines=${r1.rowOverride.lineCount}/${r1.rowOverride.truncatedLines} verbosity=${r1.rowOverride.verbosity}`);
  console.log(`  row2 compact -> lines=${r2.rowOverride.lineCount}/${r2.rowOverride.truncatedLines} verbosity=${r2.rowOverride.verbosity}`);
  ok(r1.rowOverride.lineCount === 3, `P6 compact row1 shows 3 lines (got ${r1.rowOverride.lineCount})`);

  modes.setDisplayMode(sess, 'full');
  const r3 = modes.apply(turnId, toolCompleted(sess, 'read_file', multi));
  console.log(`  --- switched to full mid-turn ---`);
  console.log(`  row3 full    -> lines=${r3.rowOverride.lineCount}/${r3.rowOverride.truncatedLines} verbosity=${r3.rowOverride.verbosity}`);
  ok(r3.rowOverride.verbosity === 'full' && r3.rowOverride.lineCount === 5, `P6 row3 is full (got ${r3.rowOverride.verbosity}/${r3.rowOverride.lineCount} lines)`);

  // The ledger proves rows 1 and 2 were not rewritten by the switch.
  const ledger = modes.turn(turnId);
  console.log(`  ledger rows -> ${ledger.rows.map((r) => `${r.rowOverride.verbosity}:${r.rowOverride.lineCount}L allowed=${r.allowed}`).join(', ')}`);
  ok(j(ledger.rows[0].rowOverride) === snap1, 'P6 row1 byte-identical after mid-turn switch');
  ok(j(ledger.rows[1].rowOverride) === snap2, 'P6 row2 byte-identical after mid-turn switch');
  ok(ledger.rows[0].rowOverride.verbosity === 'compact' && ledger.rows[1].rowOverride.verbosity === 'compact', 'P6 first 2 rows still compact');
  ok(ledger.rows[2].rowOverride.verbosity === 'full', 'P6 3rd row is full');
  ok(ledger.rows.length === 3, `P6 ledger holds exactly 3 rows (got ${ledger.rows.length})`);

  // Scope C rows were not mutated: renderer still returns its own canonical output.
  const scopeC = rows.render(toolCompleted(sess, 'read_file', multi));
  console.log(`  Scope C canonical content unchanged -> ${scopeC.content.split('\n').length} lines, rowType=${scopeC.rowType}`);
  ok(scopeC.content === multi, 'P6 Scope C rows/ code untouched by verbosity overrides');
}

// P7 Determinism: same (session, mode, event) twice -> identical apply() output.
console.log('\n════ P7 — determinism for same (session, mode, event) ════');
{
  modes._reset();
  const sess = 'sess-p7';
  modes.setDisplayMode(sess, 'compact');
  modes.setInteractionMode(sess, 'act');
  const ev = toolStarted(sess, 'edit_file', { path: '/tmp/d.txt', patch: '@@ -1 +1 @@' });

  const out1 = modes.apply('turn-p7', ev);
  const out2 = modes.apply('turn-p7', ev);
  console.log(`  out1 -> ${j(out1)}`);
  console.log(`  out2 -> ${j(out2)}`);
  ok(j(out1) === j(out2), 'P7 identical apply() output for identical inputs');

  // Same verdict after a restart (no hidden clock/counter on the path).
  modes._simulateRestart();
  const out3 = modes.apply('turn-p7b', ev);
  console.log(`  out3 (post-restart) -> ${j(out3)}`);
  ok(j({ ...out1, turnId: 'turn-p7b' }) === j(out3), 'P7 still identical after restart');

  // Plan-mode refusal is deterministic too.
  modes.setInteractionMode(sess, 'plan');
  const p1 = modes.apply('turn-p7c', ev);
  const p2 = modes.apply('turn-p7c', ev);
  console.log(`  plan refusal -> allowed=${p1.allowed} reason=${p1.reason} (twice identical=${j(p1) === j(p2)})`);
  ok(j(p1) === j(p2), 'P7 plan-mode refusal deterministic');
  ok(p1.allowed === false && p1.reason === 'E_PLAN_MODE_READONLY', 'P7 refusal reason stable');
}

console.log(`\n════ SCOPE H PROBE DONE — ${pass} passed, ${fail} failed ════`);
process.exit(fail === 0 ? 0 : 1);

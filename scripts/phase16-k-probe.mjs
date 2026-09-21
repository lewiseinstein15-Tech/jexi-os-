#!/usr/bin/env node
// Phase 16 Scope K — Tool-Call Cards probe
import { toolcards } from '../ui/web/console/chat/toolcards.js';
import { runtime } from '../ui/web/console/chat/runtime.js';
import { router } from '../ui/web/console/chat/router.js';
import { modes } from '../ui/web/console/chat/modes.js';
import { approvals } from '../ui/web/console/chat/approvals.js';
import { draft } from '../ui/web/console/chat/progress-draft.js';
import { taxonomy } from '../events/chat/taxonomy.js';

let pass = 0, fail = 0;
const ok = (c, msg) => { c ? pass++ : fail++; console.log(`  ${c ? '✅' : '❌'} ${msg}`); };
const j = (v) => JSON.stringify(v);

console.log('=== Phase 16 K — Tool-Call Cards ===');

const hardReset = () => {
  toolcards._reset();
  runtime._reset();
  router._reset();
  modes._reset();
  approvals._reset();
  draft._reset();
};

/** Run a real Scope J turn and return its routed envelopes. */
async function runTurn(sess, userInput, tools, modePatch) {
  hardReset();
  runtime.attach(sess);
  if (modePatch) runtime.mode(sess, modePatch);
  const agent = () => (async function* a() { for (const t of tools) yield { kind: 'tool', ...t }; })();
  const { turnId, stream } = runtime.send(sess, userInput, { agent });
  const envelopes = [];
  for await (const e of stream) envelopes.push(e);
  return { turnId, envelopes };
}

const byType = (list, type) => list.filter((e) => e.type === type);

// P1 bash tool.started -> cardType 'bash', status 'running', header shows command.
//    Update with completed -> status 'ok', footer durationMs. Full card JSON.
console.log('\n════ P1 — bash card: open, close, full JSON ════');
{
  const sess = 'sess-p1';
  const { envelopes } = await runTurn(sess, 'list the files', [
    { name: 'bash', args: { command: 'ls -la | grep foo' }, destructive: false },
  ]);
  const started = byType(envelopes, 'tool.started')[0];
  const completed = byType(envelopes, 'tool.completed')[0];
  console.log(`  routed envelopes -> ${j(envelopes.map((e) => e.type))}`);

  const card = toolcards.build(started);
  console.log(`  card after tool.started -> ${j(card)}`);
  ok(card.cardType === 'bash', `P1 cardType bash (got ${card.cardType})`);
  ok(card.status === 'running', `P1 status running (got ${card.status})`);
  ok(card.header.label === 'ls, grep', `P1 header shows the pipeline commands (got ${j(card.header.label)})`);
  ok(card.header.badge.text === 'running', 'P1 header carries a status badge');
  ok(card.header.args !== null && card.header.args.includes('ls -la'), 'P1 args shown at default compact verbosity');
  ok(Array.isArray(card.body.artifacts) && card.body.artifacts.length === 0, 'P1 no artifacts while running');

  const closed = toolcards.build(completed);
  console.log(`  card after tool.completed -> ${j(closed)}`);
  ok(closed.status === 'ok', `P1 status ok after completion (got ${closed.status})`);
  ok(closed.footer.durationMs !== null, `P1 footer carries durationMs (got ${closed.footer.durationMs})`);
  ok(typeof closed.footer.durationMs === 'number' && closed.footer.durationMs >= 0, 'P1 durationMs derived from event timestamps');
  ok(closed.startedAt !== undefined && closed.endedAt !== undefined, 'P1 card records startedAt/endedAt');
  ok(closed.footer.unclassified === undefined, 'P1 a known tool is not flagged unclassified');

  const st = toolcards.status(closed.cardId);
  console.log(`  status(${closed.cardId}) -> ${j(st)}`);
  ok(st.cardType === 'bash' && st.status === 'ok' && st.startedAt !== undefined && st.endedAt !== undefined, 'P1 status() returns the lifecycle record');
  ok(toolcards.openCount() === 0, 'P1 no card left open');
}

// P2 edit card -> header shows path, body shows patch when verbosity allows,
//    artifacts contains the patched file (path, kind, size, hash).
console.log('\n════ P2 — edit card: path header, patch body, artifacts ════');
{
  const sess = 'sess-p2';
  const patch = '@@ -1,3 +1,4 @@\n-const a = 1;\n+const a = 2;\n+const b = 3;';
  const { envelopes } = await runTurn(sess, 'edit the file', [
    { name: 'edit_file', args: { path: '/src/app.js', patch }, destructive: false },
  ], { displayMode: 'full' });

  const started = byType(envelopes, 'tool.started')[0];
  const completed = byType(envelopes, 'tool.completed')[0];
  const opened = toolcards.build(started);
  const card = toolcards.build(completed);
  console.log(`  opened -> cardType=${opened.cardType} header=${j(opened.header)}`);
  console.log(`  closed -> ${j(card)}`);

  ok(card.cardType === 'edit', `P2 cardType edit (got ${card.cardType})`);
  ok(card.header.label === '/src/app.js', `P2 header shows the path (got ${j(card.header.label)})`);
  ok(card.body.verbosity === 'full', `P2 body verbosity from Scope H (got ${card.body.verbosity})`);
  ok(card.body.content === patch, 'P2 body shows the full patch at full verbosity');
  console.log(`  artifacts -> ${j(card.body.artifacts)}`);
  ok(card.body.artifacts.length === 1, `P2 one artifact for the patched file (got ${card.body.artifacts.length})`);
  const art = card.body.artifacts[0];
  ok(art.path === '/src/app.js', `P2 artifact path (got ${art.path})`);
  ok(art.kind === 'patch', `P2 artifact kind patch (got ${art.kind})`);
  ok(typeof art.size === 'number' && art.size > 0, `P2 artifact size in bytes (got ${art.size})`);
  ok(typeof art.hash === 'string' && /^[0-9a-f]{16}$/.test(art.hash), `P2 artifact hash is a 64-bit fingerprint (got ${art.hash})`);
  ok(art.size === new TextEncoder().encode(patch).length, `P2 size matches the patch byte length (${art.size})`);
  ok(art.hash === toolcards.fingerprint(patch), 'P2 hash is reproducible from the content');
  // The artifact entry is metadata ONLY — Scope L owns rendering the content.
  ok(j(Object.keys(art).sort()) === j(['hash', 'kind', 'path', 'size']), `P2 artifact entry has exactly path/kind/size/hash (got ${j(Object.keys(art))})`);
  ok(!j(art).includes('const'), 'P2 the artifact entry carries NO inline content');

  // At inline the same card hides args and body.
  const { envelopes: e2 } = await runTurn('sess-p2b', 'edit the file', [
    { name: 'edit_file', args: { path: '/src/app.js', patch }, destructive: false },
  ], { displayMode: 'inline' });
  toolcards.build(byType(e2, 'tool.started')[0]);
  const inlineCard = toolcards.build(byType(e2, 'tool.completed')[0]);
  console.log(`  inline edit card -> header.args=${j(inlineCard.header.args)} body=${j(inlineCard.body)}`);
  ok(inlineCard.header.args === null, 'P2 inline hides args');
  ok(inlineCard.body.content === '', 'P2 inline renders no body');
  ok(inlineCard.body.artifacts.length === 1, 'P2 inline still reports the artifact metadata');
}

// P3 refused card: plan-mode write tool -> status 'refused', named reason, no fake ok.
console.log('\n════ P3 — refused card carries the Scope H reason ════');
{
  const sess = 'sess-p3';
  const { envelopes } = await runTurn(sess, 'write the file', [
    { name: 'write_file', args: { path: '/tmp/x', content: 'hi' }, destructive: false },
  ], { interactionMode: 'plan', displayMode: 'compact' });

  const started = byType(envelopes, 'tool.started')[0];
  console.log(`  routed tool.started -> refused=${started.refused} reason=${started.modes.reason}`);
  ok(started.refused === true, 'P3 the routed envelope really is refused');

  const card = toolcards.build(started);
  console.log(`  refused card -> ${j(card)}`);
  ok(card.status === 'refused', `P3 status refused (got ${card.status})`);
  ok(card.footer.error === 'E_PLAN_MODE_READONLY', `P3 footer carries the named Scope H reason (got ${card.footer.error})`);
  ok(card.header.badge.text === 'refused', 'P3 badge shows refused');
  ok(card.status !== 'ok', 'P3 no fake ok');
  ok(card.endedAt !== undefined, 'P3 a refused card is terminal');

  let tcode = null;
  try { toolcards.update(card.cardId, { status: 'ok' }); } catch (e) { tcode = e.code; }
  console.log(`  update(refused -> ok) threw code=${tcode}`);
  ok(tcode === 'E_INVALID_TRANSITION', 'P3 a refused card cannot be upgraded to ok');

  // Scope J also emits tool.failed for the refusal. That is a duplicate close
  // signal: re-asserting the same terminal status is idempotent, not an error,
  // and must never quietly become 'ok'.
  const failedEnv = byType(envelopes, 'tool.failed')[0];
  const afterDup = toolcards.build(failedEnv);
  console.log(`  duplicate tool.failed -> status=${afterDup.status} error=${afterDup.footer.error}`);
  ok(afterDup.status === 'refused', 'P3 a duplicate close keeps the card refused');
  ok(afterDup.footer.error === 'E_PLAN_MODE_READONLY', 'P3 the named reason survives the duplicate close');
  ok(toolcards.openCount() === 0, 'P3 no card left open');
}

// P4 invalid transition: pending -> ok directly -> E_INVALID_TRANSITION.
console.log('\n════ P4 — forward-only state machine ════');
{
  hardReset();
  const sess = 'sess-p4';
  // A progress envelope with no preceding tool.started leaves the card pending.
  const ev = {
    type: 'tool.progress', version: 1, ts: '2026-09-21T00:00:00.000Z', sessionId: sess, agentId: 'a',
    payload: { toolCallId: 'tc-p4', toolName: 'bash', progress: 0.5, message: 'halfway' },
  };
  const env = router.route(sess, ev);
  const card = toolcards.build(env);
  console.log(`  card from tool.progress -> status=${card.status}`);
  ok(card.status === 'pending', `P4 card opens pending (got ${card.status})`);

  for (const bad of ['ok', 'failed', 'refused']) {
    let code = null;
    try { toolcards.update(card.cardId, { status: bad }); } catch (e) { code = e.code; }
    console.log(`  pending -> ${bad} threw code=${code}`);
    ok(code === 'E_INVALID_TRANSITION', `P4 pending -> ${bad} rejected with E_INVALID_TRANSITION`);
  }

  ok(toolcards.update(card.cardId, { status: 'running' }).status === 'running', 'P4 pending -> running allowed');
  let back = null;
  try { toolcards.update(card.cardId, { status: 'pending' }); } catch (e) { back = e.code; }
  console.log(`  running -> pending threw code=${back}`);
  ok(back === 'E_INVALID_TRANSITION', 'P4 backward transition rejected');
  ok(toolcards.update(card.cardId, { status: 'ok' }).status === 'ok', 'P4 running -> ok allowed');

  let unknown = null;
  try { toolcards.update(card.cardId, { status: 'exploded' }); } catch (e) { unknown = e.code; }
  console.log(`  -> exploded threw code=${unknown}`);
  ok(unknown === 'E_UNKNOWN_STATUS', `P4 unknown status -> E_UNKNOWN_STATUS (got ${unknown})`);

  let nocard = null;
  try { toolcards.update('card:does-not-exist', { status: 'ok' }); } catch (e) { nocard = e.code; }
  ok(nocard === 'E_UNKNOWN_CARD', `P4 unknown cardId -> E_UNKNOWN_CARD (got ${nocard})`);
  console.log(`  transition table -> ${j(toolcards.transitions())}`);
}

// P5 unknown tool name -> cardType 'generic', footer.unclassified true.
console.log('\n════ P5 — unknown tool name falls back to generic, logged ════');
{
  const sess = 'sess-p5';
  const { envelopes } = await runTurn(sess, 'frobnicate', [
    { name: 'frobnicate_widget', args: { level: 3 }, destructive: false },
  ]);
  const started = byType(envelopes, 'tool.started')[0];
  const card = toolcards.build(started);
  console.log(`  card -> cardType=${card.cardType} footer=${j(card.footer)}`);
  ok(card.cardType === 'generic', `P5 cardType generic (got ${card.cardType})`);
  ok(card.footer.unclassified === true, 'P5 footer.unclassified true');
  ok(card.header.label === 'frobnicate_widget', 'P5 header falls back to the tool name');
  ok(card.status === 'running', 'P5 the card still opens and runs');

  // Every tool name the phase-16 probes and runtime actually use must map
  // to a SPECIFIC card type — no silent generic fallback for known tools.
  const known = ['read_file', 'write_file', 'edit_file', 'exec_command', 'grep_search', 'list_directory', 'delete_file', 'bash'];
  const mapped = Object.fromEntries(known.map((n) => [n, toolcards.cardTypeFor(n)]));
  console.log(`  known tool mapping -> ${j(mapped)}`);
  ok(known.every((n) => toolcards.cardTypeFor(n) !== 'generic'), 'P5 every runtime/probe tool maps to a specific card type');

  const extra = ['todo_write', 'update_plan', 'task', 'think', 'ask_question', 'create_artifact', 'mcp_files__write'];
  const mappedExtra = Object.fromEntries(extra.map((n) => [n, toolcards.cardTypeFor(n)]));
  console.log(`  full taxonomy mapping -> ${j(mappedExtra)}`);
  ok(extra.every((n) => toolcards.cardTypeFor(n) !== 'generic'), 'P5 todo/plan/subagent/thinking/question/artifact/mcp all map');
  ok(new Set([...Object.values(mapped), ...Object.values(mappedExtra)]).size >= 8, 'P5 mapping actually discriminates between card types');
}

// P6 tool.completed without a matching open card -> E_NO_OPEN_CARD.
console.log('\n════ P6 — no open card ════');
{
  hardReset();
  const sess = 'sess-p6';
  const ev = {
    type: 'tool.completed', version: 1, ts: '2026-09-21T00:00:00.000Z', sessionId: sess, agentId: 'a',
    payload: { toolCallId: 'tc-orphan', toolName: 'bash', result: 'done' },
  };
  const env = router.route(sess, ev);
  let code = null, msg = null;
  try { toolcards.build(env); } catch (e) { code = e.code; msg = e.message; }
  console.log(`  build(orphan tool.completed) threw code=${code}`);
  console.log(`  message: ${msg}`);
  ok(code === 'E_NO_OPEN_CARD', `P6 E_NO_OPEN_CARD (got ${code})`);
  ok(typeof msg === 'string' && msg.includes('tc-orphan'), 'P6 the error names the orphan toolCallId');
  ok(toolcards.list().length === 0, 'P6 no card was created by the rejected build');

  // Same for a failed event with no open card.
  const failEv = { ...ev, type: 'tool.failed', payload: { toolCallId: 'tc-orphan2', toolName: 'bash', error: 'boom' } };
  let fcode = null;
  try { toolcards.build(router.route(sess, failEv)); } catch (e) { fcode = e.code; }
  console.log(`  build(orphan tool.failed) threw code=${fcode}`);
  ok(fcode === 'E_NO_OPEN_CARD', 'P6 orphan tool.failed also refused');

  // A raw Scope A event (not a routed envelope) must be rejected outright.
  let rcode = null;
  try { toolcards.build(ev); } catch (e) { rcode = e.code; }
  console.log(`  build(raw Scope A event) threw code=${rcode}`);
  ok(rcode === 'E_NOT_ROUTED', `P6 a raw event is refused with E_NOT_ROUTED (got ${rcode})`);
  ok(taxonomy.validate(ev).valid === true, 'P6 (that raw event was itself valid — the refusal is about provenance)');
}

// P7 determinism: same routed envelope + same modes -> byte-identical card.
console.log('\n════ P7 — determinism ════');
{
  const runOnce = async (sess) => {
    const { envelopes } = await runTurn(sess, 'do the work', [
      { name: 'edit_file', args: { path: '/src/x.js', patch: '@@ -1 +1 @@\n-a\n+b' }, destructive: false },
      { name: 'bash', args: { command: 'npm test' }, destructive: false },
    ], { displayMode: 'compact', interactionMode: 'act' });
    toolcards._reset();
    const toolEnvelopes = envelopes.filter((e) => toolcards.isToolEvent(e));
    return toolEnvelopes.map((e) => toolcards.build(e));
  };

  const a = await runOnce('sess-p7a');
  const b = await runOnce('sess-p7b');
  // A card is the visual unit of a TOOL CALL: non-tool envelopes must be
  // refused, not quietly minted as 'generic' cards.
  {
    const { envelopes: all } = await runTurn('sess-p7c', 'do the work', [
      { name: 'edit_file', args: { path: '/src/x.js', patch: '@@ -1 +1 @@\n-a\n+b' }, destructive: false },
    ], { displayMode: 'compact', interactionMode: 'act' });
    const nonTool = all.filter((e) => !toolcards.isToolEvent(e));
    const codes = nonTool.map((e) => { try { toolcards.build(e); return '(no throw)'; } catch (err) { return err.code; } });
    console.log(`  non-tool envelopes=${j(nonTool.map((e) => e.type))} -> ${j(codes)}`);
    ok(nonTool.length > 0 && codes.every((c) => c === 'E_NOT_TOOL_EVENT'), 'P7 non-tool envelopes refused with E_NOT_TOOL_EVENT');
    ok(a.every((c) => c.cardType !== 'generic'), 'P7 no stray generic cards from a fully-classified turn');
  }
  console.log(`  run1 cards -> ${a.map((c) => `${c.cardType}:${c.status}`).join(', ')}`);
  console.log(`  run2 cards -> ${b.map((c) => `${c.cardType}:${c.status}`).join(', ')}`);

  // Normalise only the session-scoped identifiers, which differ by design.
  const norm = (cards) => j(cards.map((c) => ({
    ...c,
    cardId: c.cardId.replace(/^card:tc-sess-p7[ab]:turn-1-/, 'card:tc-TURN-'),
    tool: { ...c.tool, sessionId: 'S', turnId: 'T', toolCallId: c.tool.toolCallId.replace(/^tc-sess-p7[ab]:turn-1-/, 'tc-TURN-') },
  })));
  ok(norm(a) === norm(b), 'P7 byte-identical cards for the same envelopes + modes');
  ok(j(a.map((c) => c.body)) === j(b.map((c) => c.body)), 'P7 bodies byte-identical');
  ok(j(a.map((c) => c.body.artifacts)) === j(b.map((c) => c.body.artifacts)), 'P7 artifact hashes byte-identical');
  ok(j(a.map((c) => c.footer.durationMs)) === j(b.map((c) => c.footer.durationMs)), 'P7 durations reproducible (derived from event ts, not a clock)');
  console.log(`  durations -> ${j(a.map((c) => c.footer.durationMs))}`);
}

// P8 display mode ladder: same card at inline / minimal / compact / full.
console.log('\n════ P8 — display mode ladder ════');
{
  hardReset();
  const sess = 'sess-p8';
  const output = 'line-1: alpha\nline-2: bravo\nline-3: charlie\nline-4: delta\nline-5: echo';
  const mk = (type, extra) => ({
    type, version: 1, ts: '2026-09-21T00:00:00.000Z', sessionId: sess, agentId: 'agent-root',
    payload: { toolCallId: 'tc-p8', toolName: 'bash', args: { command: 'cat /etc/hosts | head -5' }, ...extra },
  });

  const ladder = {};
  for (const mode of ['inline', 'minimal', 'compact', 'full']) {
    modes.setDisplayMode(sess, mode);
    const startEnv = router.route(sess, mk('tool.started'));
    const doneEnv = router.route(sess, mk('tool.completed', { result: output }));
    toolcards.build(startEnv, { cardId: `ladder-${mode}` });
    ladder[mode] = toolcards.build(doneEnv, { cardId: `ladder-${mode}` });
  }

  for (const mode of ['inline', 'minimal', 'compact', 'full']) {
    const c = ladder[mode];
    console.log(`  ${mode.padEnd(8)} args=${c.header.args === null ? 'hidden' : 'shown'} body=${j(c.body.content)} (verbosity=${c.body.verbosity})`);
    ok(c.body.verbosity === mode, `P8 ${mode}: body.verbosity = ${mode}`);
  }
  ok(ladder.inline.header.args === null, 'P8 inline hides args');
  ok(ladder.inline.body.content === '', 'P8 inline renders name only (no body)');
  ok(ladder.minimal.body.content.split('\n').length === 1, `P8 minimal = 1 line (got ${ladder.minimal.body.content.split('\n').length})`);
  ok(ladder.compact.body.content.split('\n').length === 3, `P8 compact = 3 lines (got ${ladder.compact.body.content.split('\n').length})`);
  ok(ladder.full.body.content.split('\n').length === 5, `P8 full = all 5 lines (got ${ladder.full.body.content.split('\n').length})`);
  ok(ladder.minimal.header.args !== null && ladder.compact.header.args !== null && ladder.full.header.args !== null, 'P8 args shown at minimal/compact/full (Scope H rowOverride.showArgs)');
  ok(ladder.inline.status === 'ok' && ladder.full.status === 'ok', 'P8 verbosity does not affect the lifecycle');
  console.log(`  artifacts identical across the ladder -> ${j(ladder.inline.body.artifacts) === j(ladder.full.body.artifacts)}`);
  ok(j(ladder.inline.body.artifacts) === j(ladder.full.body.artifacts), 'P8 artifacts are verbosity-independent');
}

// P9 Lifecycle integrity: no fabricated outcomes, closed cards are immutable.
console.log('\n════ P9 — lifecycle integrity ════');
{
  hardReset();
  const sess = 'sess-p9';
  const { envelopes } = await runTurn(sess, 'run it', [
    { name: 'bash', args: { command: 'npm test' }, destructive: false },
  ]);
  const started = byType(envelopes, 'tool.started')[0];
  const completed = byType(envelopes, 'tool.completed')[0];

  const opened = toolcards.build(started);
  ok(opened.status === 'running', `P9 card opens running (got ${opened.status})`);

  // A duplicate open must NOT fall through and fabricate an 'ok'.
  let dupCode = null;
  try { toolcards.build(started); } catch (e) { dupCode = e.code; }
  console.log(`  duplicate tool.started -> code=${dupCode}, status still ${toolcards.status(opened.cardId).status}`);
  ok(dupCode === 'E_CARD_ALREADY_OPEN', `P9 duplicate tool.started -> E_CARD_ALREADY_OPEN (got ${dupCode})`);
  ok(toolcards.status(opened.cardId).status === 'running', 'P9 the duplicate did not change the card');

  const closed = toolcards.build(completed);
  ok(closed.status === 'ok', 'P9 the real completion closes the card');
  const frozenBody = closed.body.content;

  // A closed card is immutable: late progress must not rewrite it.
  const lateProgress = router.route(sess, {
    type: 'tool.progress', version: 1, ts: '2026-09-21T00:00:00.000Z', sessionId: sess, agentId: 'agent-root',
    payload: { toolCallId: started.event.payload.toolCallId, toolName: 'bash', progress: 0.9, message: 'too late' },
  });
  let progCode = null;
  try { toolcards.build(lateProgress); } catch (e) { progCode = e.code; }
  console.log(`  progress on a closed card -> code=${progCode}`);
  ok(progCode === 'E_INVALID_TRANSITION', `P9 progress on a closed card -> E_INVALID_TRANSITION (got ${progCode})`);
  ok(toolcards.get(opened.cardId).body.content === frozenBody, 'P9 the closed card body was not rewritten');

  // A real mid-flight progress DOES update an open card.
  hardReset();
  const s2 = 'sess-p9b';
  const stEnv = router.route(s2, {
    type: 'tool.started', version: 1, ts: '2026-09-21T00:00:00.000Z', sessionId: s2, agentId: 'agent-root',
    payload: { toolCallId: 'tc-p9', toolName: 'bash', args: { command: 'sleep 1' } },
  });
  toolcards.build(stEnv);
  const prEnv = router.route(s2, {
    type: 'tool.progress', version: 1, ts: '2026-09-21T00:00:00.000Z', sessionId: s2, agentId: 'agent-root',
    payload: { toolCallId: 'tc-p9', toolName: 'bash', progress: 0.5, message: 'halfway' },
  });
  const progressed = toolcards.build(prEnv);
  console.log(`  mid-flight progress -> status=${progressed.status} body=${j(progressed.body.content)}`);
  ok(progressed.status === 'running', 'P9 progress keeps the card running');
  ok(progressed.body.content.includes('halfway'), 'P9 progress updates the body of an open card');
  ok(toolcards.openCount() === 1, 'P9 the card is still open after progress');
}

console.log(`\n════ SCOPE K PROBE DONE — ${pass} passed, ${fail} failed ════`);
process.exit(fail === 0 ? 0 : 1);

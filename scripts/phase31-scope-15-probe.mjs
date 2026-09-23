/**
 * JEXI OS — PHASE 31 SCOPE 15 — live probe: OSWorld adapter (build-only).
 *
 * P1: fixture loads (mini-tasks.json: 5 entries — 4 valid tasks across
 *     web/desktop/file/multi-app + 1 malformed rejected non-silently);
 *     show app + category per task.
 * P2: adapter(mode:'coords', computer:stub).step() -> valid OSWorld
 *     actions; show a 3-step trace; missing arm + bad mode refused.
 * P3: adapter(mode:'grounding', stub VLM + stub computer) — VLM locates
 *     (JEXI proposal), the bridge translates to OSWorld shape, the
 *     computer executes (operator face); show the arbitration trace +
 *     the full frozen mapping matrix; unknown JEXI action fail-closed.
 * P4: observe() on a fixture VM state -> { screenshot, instruction, cwd,
 *     screenSize, appFocus }; show before/after; defaults + rejects.
 * P5: evaluate() with the rule evaluator on the 5 fixture entries ->
 *     3 pass, 1 fail, 1 rejected (rules decide, nothing pre-declared).
 * P6: error paths: E_UNKNOWN_ACTION, E_INVALID_ARGUMENT, E_INVALID_TASK.
 * P7: determinism: same fixture + same stub -> byte-identical reports;
 *     runsPerTask=1 and runsPerTask=5 both stable; pass@1 unchanged.
 * P8: no live VM, no Docker, no model call — grep on
 *     benchmarks/osworld/**: zero fetch/http outside the gated loader,
 *     zero spawn primitives, no VM-automation words in code, imports
 *     limited to node: builtins + local modules.
 * P9: zone check — git status ⊆ benchmarks/osworld/**,
 *     benchmarks/_fixtures/osworld/**, scripts/phase31-*.mjs.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OSW_DIR = path.join(ROOT, 'benchmarks', 'osworld');
const FIXTURE = path.join(ROOT, 'benchmarks', '_fixtures', 'osworld', 'mini-tasks.json');
const OBSERVATIONS = path.join(ROOT, 'benchmarks', '_fixtures', 'osworld', 'mini-observations.json');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'w31s15-probe-'));
const FAILS = [];
let n = 0;
function check(id, ok, detail) {
  n += 1;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${id} — ${detail}`);
  if (!ok) FAILS.push(`${id}: ${detail}`);
}
const j = (v) => JSON.stringify(v);
const sha16 = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

const osw = (await import(pathToFileURL(path.join(OSW_DIR, 'index.js')))).osw;
const obsRaw = JSON.parse(fs.readFileSync(OBSERVATIONS, 'utf8'));
const fixtureRaw = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

/* ===================== P1 — fixture loads, shapes ========================= */
console.log('== P1: fixture loads — 4 valid tasks + 1 malformed, app + category per task ==');
const tasks = await osw.load({ split: 'mini' });
console.log(tasks.map((t) => `  ${j(t)}`).join('\n'));
check('P1.valid-4', tasks.length === 4, `${tasks.length} valid tasks loaded (expected 4; the malformed 5th entry is rejected, never silently dropped)`);
check('P1.ids', j(tasks.map((t) => t.task_id)) === j(['osw-mini-001', 'osw-mini-002', 'osw-mini-003', 'osw-mini-004']), `ids: ${j(tasks.map((t) => t.task_id))}`);
check('P1.task-shape', tasks.every((t) =>
  typeof t.task_id === 'string' && typeof t.instruction === 'string' && t.instruction.trim() !== '' &&
  typeof t.app === 'string' && osw.APPS.includes(t.app) && typeof t.category === 'string' &&
  t.category.trim() !== '' && !!t.evaluator && t.source === 'fixture'
), 'every task carries {task_id, instruction, app, category, evaluator, source:"fixture"} with app inside the frozen 10-app OSWorld enum');
console.log(`  app + category per task: ${tasks.map((t) => `${t.task_id} ${t.app}/${t.category}`).join(', ')}`);
check('P1.app-coverage', j(tasks.map((t) => `${t.app}/${t.category}`)) === j(['chrome/web', 'gimp/desktop', 'os/file', 'multi_apps/multi_app']), 'web/desktop/file/multi-app coverage as the block requires');
const diag = await osw.loadDiagnostics({ split: 'mini' });
check('P1.rejected-surfaced', diag.rejected.length === 1 && diag.rejected[0].index === 4 && diag.rejected[0].task_id === 'osw-mini-005' && diag.rejected[0].code === 'E_INVALID_TASK' && /evaluator/.test(diag.rejected[0].reason),
  `malformed entry rejected non-silently: ${j(diag.rejected)}; observations fixture declared: ${diag.observationsRef}`);
check('P1.observations-declared', diag.observationsRef === 'mini-observations.json', `the tasks fixture declares its sibling snapshot file (${diag.observationsRef})`);
let strictErr = null;
try { await osw.load({ split: 'mini', strict: true }); } catch (e) { strictErr = e; }
check('P1.strict-rejects', !!strictErr && strictErr.code === 'E_INVALID_TASK', `strict load refuses the fixture outright: ${strictErr ? strictErr.message.slice(0, 84) + '…' : 'NO THROW (BAD)'}`);

/* ===================== P2 — coords-mode 3-step trace ====================== */
console.log('\n== P2: adapter(mode:coords, computer:stub).step() — 3-step OSWorld trace ==');
const SCRIPT_002 = [
  { action: 'click', args: { x: 887, y: 605 } },
  { action: 'hotkey', args: { keys: ['ctrl', 'shift', 'e'] } },
  { action: 'screenshot', args: {} },
];
const p2Computer = { coords: { propose: async ({ history }) => SCRIPT_002[history.length] } };
const coordsAdapter = osw.adapter({ mode: 'coords', computer: p2Computer });
const snaps2 = obsRaw.tasks['osw-mini-002'].snapshots;
const moves2 = [];
for (let i = 0; i < 3; i++) {
  const parsed = osw.observe(snaps2[i]);
  const move = await coordsAdapter.step(parsed);
  const v = osw.validateAction(move);
  moves2.push({ action: move.action, args: move.args });
  console.log(`  step ${i} -> ${j({ action: move.action, args: move.args })} (valid=${v.valid}, trace=${j(move.trace)})`);
  check(`P2.step-${i}`, v.valid === true && move.action === SCRIPT_002[i].action && move.trace?.arm === 'coords',
    `step ${i}: coords-arm proposal validated against the frozen OSWorld v1 space (${move.action})`);
}
check('P2.moves-match-script', j(moves2) === j(SCRIPT_002), 'the 3-step trace equals the pre-declared coords script byte-for-byte');
let armErr = null;
try { osw.adapter({ mode: 'coords', computer: {} }); } catch (e) { armErr = e; }
check('P2.arm-required', !!armErr && armErr.code === 'OSW_COMPUTER_REQUIRED', `coords mode without computer.coords.propose -> ${armErr ? armErr.code : 'NO THROW (BAD)'}`);
let gmErr = null;
try { osw.adapter({ mode: 'grounding', computer: {} }); } catch (e) { gmErr = e; }
check('P2.grounding-arm-required', !!gmErr && gmErr.code === 'OSW_COMPUTER_REQUIRED', `grounding mode without computer.grounding.propose -> ${gmErr ? gmErr.code : 'NO THROW (BAD)'}`);
let bm = null;
try { osw.adapter({ mode: 'telepathy', computer: p2Computer }); } catch (e) { bm = e; }
check('P2.bad-mode', !!bm && bm.code === 'E_INVALID_ARGUMENT', `mode outside coords|grounding -> ${bm ? bm.code : 'NO THROW (BAD)'}`);

/* ===================== P3 — grounding arbitration ========================= */
console.log('\n== P3: adapter(mode:grounding) — VLM locates, bridge translates, computer executes ==');
const SCRIPT_001 = [
  { action: 'click', args: { start_box: [1043, 76, 1147, 108] } },
  { action: 'type', args: { content: 'Nairobi' } },
  { action: 'finished', args: { content: 'booked' } },
];
const p3Computer = {
  grounding: { propose: async ({ history }) => SCRIPT_001[history.length] },
  execute: async ({ action }) => ({ ok: true, result: { dispatched: action } }),
};
const grounding = osw.adapter({ mode: 'grounding', computer: p3Computer });
const snaps1 = obsRaw.tasks['osw-mini-001'].snapshots;
const EXPECTED_001 = [
  { action: 'click', args: { x: 1095, y: 92 } },
  { action: 'type', args: { text: 'Nairobi' } },
  { action: 'done', args: {} },
];
const moves3 = [];
for (let i = 0; i < 3; i++) {
  const parsed = osw.observe(snaps1[i]);
  const move = await grounding.step(parsed);
  const v = osw.validateAction(move);
  moves3.push({ action: move.action, args: move.args });
  console.log(`  step ${i}: VLM locates ${j(move.trace.from)} -> bridge translates to ${j(move.trace.to)} -> computer executes ${j(move.trace.executed)} (valid=${v.valid})`);
  check(`P3.step-${i}`,
    v.valid === true && move.trace.arm === 'grounding' && move.trace.locate === 'vlm' && move.trace.execute === 'computer' &&
    j(move.trace.from) === j(SCRIPT_001[i]) && j(move.trace.to) === j(EXPECTED_001[i]) &&
    move.trace.executed?.ok === true,
    `step ${i}: arbitration visible — locate(vlm) -> from(JEXI ${SCRIPT_001[i].action}) -> to(OSWorld ${move.action}) -> executed(ok=true)`);
}
check('P3.moves-match-expected', j(moves3) === j(EXPECTED_001), 'the translated 3-step trace equals the expected OSWorld script byte-for-byte');
check('P3.box-center', moves3[0].args.x === 1095 && moves3[0].args.y === 92, 'bracket box [1043,76,1147,108] reduced to its Math.round center (1095, 92) — Phase 29 box semantics');
check('P3.finished-content-dropped', SCRIPT_001[2].args.content === 'booked' && j(moves3[2].args) === j({}), 'finished.content is dropped (declared) but the proposal stays visible in trace.from');

console.log('  -- frozen mapping matrix (translateJexi) --');
const MATRIX = [
  [{ action: 'click', args: { start_box: { x: 10, y: 20 } } }, { action: 'click', args: { x: 10, y: 20 } }],
  [{ action: 'right_single', args: { start_box: { x: 10, y: 20 } } }, { action: 'right_click', args: { x: 10, y: 20 } }],
  [{ action: 'left_double', args: { start_box: [5, 6, 15, 26] } }, { action: 'double_click', args: { x: 10, y: 16 } }],
  [{ action: 'drag', args: { start_box: { x: 1, y: 2 }, end_box: { x: 3, y: 4 } } }, { action: 'drag', args: { from: { x: 1, y: 2 }, to: { x: 3, y: 4 } } }],
  [{ action: 'hotkey', args: { key: 'ctrl+shift+e' } }, { action: 'hotkey', args: { keys: ['ctrl', 'shift', 'e'] } }],
  [{ action: 'type', args: { content: 'Nairobi' } }, { action: 'type', args: { text: 'Nairobi' } }],
  [{ action: 'scroll', args: { start_box: { x: 640, y: 400 }, direction: 'up' } }, { action: 'scroll', args: { dx: 0, dy: -1 } }],
  [{ action: 'scroll', args: { start_box: { x: 640, y: 400 }, direction: 'down' } }, { action: 'scroll', args: { dx: 0, dy: 1 } }],
  [{ action: 'scroll', args: { start_box: { x: 640, y: 400 }, direction: 'left' } }, { action: 'scroll', args: { dx: -1, dy: 0 } }],
  [{ action: 'scroll', args: { start_box: { x: 640, y: 400 }, direction: 'right' } }, { action: 'scroll', args: { dx: 1, dy: 0 } }],
  [{ action: 'wait', args: {} }, { action: 'wait', args: { seconds: 1 } }],
  [{ action: 'finished', args: {} }, { action: 'done', args: {} }],
];
for (const [from, to] of MATRIX) {
  const t = osw.translateJexi(from);
  const v = osw.validateAction(t);
  console.log(`    ${j(from)} -> ${j(t)}`);
  check(`P3.map-${from.action}-${to.action}`, v.valid === true && j(t) === j(to), `${from.action} maps to ${to.action} per the frozen v1 bridge table (translated output is a valid OSWorld action)`);
}
const groundingBad = osw.adapter({
  mode: 'grounding',
  computer: { grounding: { propose: async () => ({ action: 'open', args: { app: 'browser' } }) } },
});
let uj = null;
try { await groundingBad.step(osw.observe(snaps1[0])); } catch (e) { uj = e; }
console.log(`  fail-closed: VLM proposes JEXI 'open' -> ${uj ? `${uj.code}: ${uj.message.slice(0, 90)}…` : 'NO THROW (BAD)'}`);
check('P3.unknown-jexi-action', !!uj && uj.code === 'E_UNKNOWN_ACTION' && uj.message.includes('Phase 29 v1'), "an action outside the Phase 29 v1 vocabulary is rejected with E_UNKNOWN_ACTION naming that space — fail-closed, never translated");

/* ===================== P4 — observation parsing =========================== */
console.log('\n== P4: observe() on a fixture VM state — 5-key OSWorld format ==');
const rawSnap = obsRaw.tasks['osw-mini-003'].snapshots[2];
const parsed = osw.observe(rawSnap);
console.log(`  before (raw state): ${j(rawSnap)}`);
console.log(`  after  (observe):   ${j(parsed)}`);
check('P4.shape-5-keys', Object.keys(parsed).sort().join(',') === 'appFocus,cwd,instruction,screenSize,screenshot', 'output has exactly the five OSWorld observation keys; snapshot extras dropped');
check('P4.preserved', parsed.screenshot === rawSnap.screenshot && parsed.instruction === rawSnap.instruction && parsed.cwd === '/home/jexi/archive' && parsed.appFocus === 'terminal' && j(parsed.screenSize) === j({ width: 1280, height: 800 }),
  'screenshot token and instruction preserved byte-for-byte; cwd/screenSize/appFocus carried through');
const dflt = osw.observe({ screenshot: 'snap://x/1', instruction: 'do the thing' });
check('P4.defaults', dflt.cwd === null && j(dflt.screenSize) === j(null) && dflt.appFocus === null, 'absent cwd/screenSize/appFocus default to null (unknown is honest)');
let oe1 = null, oe2 = null, oe3 = null, oe4 = null;
try { osw.observe({ instruction: 'x' }); } catch (e) { oe1 = e; }
try { osw.observe({ screenshot: 'snap://x/1' }); } catch (e) { oe2 = e; }
try { osw.observe({ screenshot: 'snap://x/1', instruction: 'x', screenSize: { width: 0, height: 800 } }); } catch (e) { oe3 = e; }
try { osw.observe({ screenshot: 'snap://x/1', instruction: 'x', appFocus: '' }); } catch (e) { oe4 = e; }
check('P4.invalid', !!oe1 && oe1.code === 'E_INVALID_OBSERVATION' && !!oe2 && oe2.code === 'E_INVALID_OBSERVATION' && !!oe3 && oe3.code === 'E_INVALID_OBSERVATION' && !!oe4 && oe4.code === 'E_INVALID_OBSERVATION',
  `missing screenshot -> ${oe1.code}; missing instruction -> ${oe2.code}; non-positive screen width -> ${oe3.code}; blank appFocus -> ${oe4.code}`);

/* ===================== P5 — rule-based evaluate =========================== */
console.log('\n== P5: evaluate() with rule evaluator on the 5 fixture entries -> 3 pass, 1 fail, 1 rejected ==');
const EXPECTED = { 'osw-mini-001': true, 'osw-mini-002': true, 'osw-mini-003': true, 'osw-mini-004': false };
const verdicts = {};
for (const task of tasks) {
  const finalState = osw.observe(obsRaw.tasks[task.task_id].snapshots.at(-1));
  const verdict = osw.evaluate(task, finalState);
  verdicts[task.task_id] = verdict.pass;
  console.log(`  ${task.task_id}: ${j(verdict.rules)} -> pass=${verdict.pass}`);
}
const passed = Object.values(verdicts).filter(Boolean).length;
check('P5.verdicts', j(verdicts) === j(EXPECTED) && passed === 3, `3 pass, 1 fail — rules decide against the recorded final VM states (nothing pre-declared): ${j(verdicts)}`);
check('P5.fail-explained', verdicts['osw-mini-004'] === false, 'osw-mini-004 fails: the episode stalled inside Calc, so app_focus(libreoffice_writer) is false against the final state');
const malformedRaw = fixtureRaw.tasks[4];
let rej = null;
try { osw.evaluate(malformedRaw, osw.observe(obsRaw.tasks['osw-mini-001'].snapshots[0])); } catch (e) { rej = e; }
console.log(`  rejected entry     -> ${rej ? `${rej.code}: ${rej.message.slice(0, 84)}…` : 'NO THROW (BAD)'}`);
check('P5.rejected-not-passfail', !!rej && rej.code === 'E_INVALID_TASK' && /missing evaluator/.test(rej.reason ?? rej.message), 'the malformed 5th entry is REJECTED (E_INVALID_TASK at evaluate time), never silently scored as pass or fail');
check('P5.binary', Object.values(verdicts).every((v) => typeof v === 'boolean'), 'binary success per task — no partial credit');

/* ===================== P6 — error paths =================================== */
console.log('\n== P6: error paths — E_UNKNOWN_ACTION, E_INVALID_ARGUMENT, E_INVALID_TASK ==');
const coordsBad = osw.adapter({ mode: 'coords', computer: { coords: { propose: async () => ({ action: 'move_to', args: { x: 1, y: 2 } }) } } });
let e1 = null;
try { await coordsBad.step(osw.observe(snaps2[0])); } catch (e) { e1 = e; }
console.log(`  unknown action (coords)    -> ${e1 ? `${e1.code}: ${e1.message.slice(0, 84)}…` : 'NO THROW (BAD)'}`);
check('P6.unknown-action-coords', !!e1 && e1.code === 'E_UNKNOWN_ACTION' && e1.message.includes('OSWorld v1'), "'move_to' outside the frozen OSWorld v1 space -> E_UNKNOWN_ACTION naming that space");

let e2 = null;
try { await groundingBad.step(osw.observe(snaps1[0])); } catch (e) { e2 = e; }
console.log(`  unknown action (grounding) -> ${e2 ? `${e2.code}: ${e2.message.slice(0, 84)}…` : 'NO THROW (BAD)'}`);
check('P6.unknown-action-grounding', !!e2 && e2.code === 'E_UNKNOWN_ACTION', "JEXI 'open' outside the Phase 29 v1 vocabulary -> E_UNKNOWN_ACTION");

const missCoord = osw.adapter({ mode: 'coords', computer: { coords: { propose: async () => ({ action: 'click', args: { y: 5 } }) } } });
const badWait = osw.adapter({ mode: 'coords', computer: { coords: { propose: async () => ({ action: 'wait', args: { seconds: 0 } }) } } });
const badButton = osw.adapter({ mode: 'coords', computer: { coords: { propose: async () => ({ action: 'click', args: { x: 1, y: 2, button: 'middleleft' } }) } } });
let e3 = null, e4 = null, e5 = null;
try { await missCoord.step(osw.observe(snaps2[0])); } catch (e) { e3 = e; }
try { await badWait.step(osw.observe(snaps2[0])); } catch (e) { e4 = e; }
try { await badButton.step(osw.observe(snaps2[0])); } catch (e) { e5 = e; }
console.log(`  missing click.x            -> ${e3 ? `${e3.code}: ${e3.message}` : 'NO THROW (BAD)'}`);
console.log(`  wait seconds=0             -> ${e4 ? `${e4.code}: ${e4.message}` : 'NO THROW (BAD)'}`);
console.log(`  bad click.button           -> ${e5 ? `${e5.code}: ${e5.message.slice(0, 70)}…` : 'NO THROW (BAD)'}`);
check('P6.invalid-arg-coords', !!e3 && e3.code === 'E_INVALID_ARGUMENT' && !!e4 && e4.code === 'E_INVALID_ARGUMENT' && !!e5 && e5.code === 'E_INVALID_ARGUMENT', 'missing click.x, non-positive wait.seconds, button outside left|middle|right -> E_INVALID_ARGUMENT');

const badChord = (() => { try { osw.translateJexi({ action: 'hotkey', args: { key: 'ctrl+' } }); } catch (e) { return e; } })();
const badPoint = (() => { try { osw.translateJexi({ action: 'click', args: { start_box: { x: 10.5, y: 20 } } }); } catch (e) { return e; } })();
const badExtra = (() => { try { osw.translateJexi({ action: 'click', args: { start_box: { x: 1, y: 2 }, position: { x: 1, y: 2 } } }); } catch (e) { return e; } })();
console.log(`  JEXI chord 'ctrl+'         -> ${badChord ? `${badChord.code}: ${badChord.message.slice(0, 70)}…` : 'NO THROW (BAD)'}`);
console.log(`  JEXI fractional point      -> ${badPoint ? `${badPoint.code}: ${badPoint.message.slice(0, 70)}…` : 'NO THROW (BAD)'}`);
console.log(`  JEXI extra arg             -> ${badExtra ? `${badExtra.code}: ${badExtra.message.slice(0, 70)}…` : 'NO THROW (BAD)'}`);
check('P6.invalid-arg-jexi', !!badChord && badChord.code === 'E_INVALID_ARGUMENT' && !!badPoint && badPoint.code === 'E_INVALID_ARGUMENT' && !!badExtra && badExtra.code === 'E_INVALID_ARGUMENT',
  "chord splitting into an empty key name, non-integer screen point (normalize() output is integral), extra JEXI arg -> E_INVALID_ARGUMENT");

const BAD_TASKS = [
  ['missing-instruction', { task_id: 'x', app: 'chrome' }],
  ['missing-app', { task_id: 'x', instruction: 'i' }],
  ['bad-app', { task_id: 'x', instruction: 'i', app: 'mspaint' }],
  ['bad-category', { task_id: 'x', instruction: 'i', app: 'os', category: '' }],
  ['missing-evaluator', { task_id: 'x', instruction: 'i', app: 'os' }],
];
const tErrs = BAD_TASKS.map(([label, t]) => {
  let err = null;
  try { osw.validateTask(t, label); } catch (e) { err = e; }
  console.log(`  ${label.padEnd(19)} -> ${err ? `${err.code}: ${err.reason ?? err.message.slice(0, 60)}` : 'NO THROW (BAD)'}`);
  return { label, err };
});
check('P6.invalid-task', tErrs.every(({ err }) => !!err && err.code === 'E_INVALID_TASK'),
  'malformed tasks (missing instruction/app, app outside the frozen enum, blank category, missing evaluator) all rejected with E_INVALID_TASK');

let runsBad = null;
try { await osw.run({ fixture: FIXTURE, split: 'mini', agent: coordsAdapter, runsPerTask: 0 }); } catch (e) { runsBad = e; }
check('P6.bad-runsPerTask', !!runsBad && runsBad.code === 'E_INVALID_ARGUMENT' && runsBad.field === 'runsPerTask', `runsPerTask=0 -> ${runsBad ? runsBad.code : 'NO THROW (BAD)'}`);

const tmpObs = JSON.parse(JSON.stringify(obsRaw));
delete tmpObs.tasks['osw-mini-001'];
const tmpObsPath = path.join(TMP, 'mini-observations-missing.json');
fs.writeFileSync(tmpObsPath, JSON.stringify(tmpObs, null, 2));
const runComputer0 = { coords: { propose: async () => ({ action: 'screenshot', args: {} }) } };
let e7 = null;
try { await osw.run({ fixture: FIXTURE, split: 'mini', agent: osw.adapter({ mode: 'coords', computer: runComputer0 }), observationsPath: tmpObsPath }); } catch (e) { e7 = e; }
console.log(`  missing obs trace  -> ${e7 ? `${e7.code}: ${e7.message.slice(0, 84)}…` : 'NO THROW (BAD)'}`);
check('P6.obs-missing-entry', !!e7 && e7.code === 'E_INVALID_OBSERVATION' && /osw-mini-001/.test(e7.message), 'run() refuses an observations fixture lacking an entry for a valid task (not silently skipped)');

/* ===================== P7 — run() + determinism =========================== */
console.log('\n== P7: run() on the fixture + determinism — byte-identical reports; runsPerTask 1 and 5 both stable ==');
const RUN_SCRIPTS = {
  'osw-mini-001': [
    { action: 'click', args: { x: 1095, y: 92 } },
    { action: 'type', args: { text: 'Nairobi' } },
    { action: 'screenshot', args: {} },
  ],
  'osw-mini-002': [
    { action: 'click', args: { x: 887, y: 605 } },
    { action: 'hotkey', args: { keys: ['ctrl', 'shift', 'e'] } },
    { action: 'screenshot', args: {} },
  ],
  'osw-mini-003': [
    { action: 'type', args: { text: 'cd ~/archive' } },
    { action: 'hotkey', args: { keys: ['Return'] } },
    { action: 'screenshot', args: {} },
  ],
  'osw-mini-004': [
    { action: 'hotkey', args: { keys: ['ctrl', 'c'] } },
    { action: 'hotkey', args: { keys: ['alt', 'tab'] } },
    { action: 'screenshot', args: {} },
  ],
};
const runComputer = {
  coords: {
    propose: async ({ task, history }) => {
      const script = RUN_SCRIPTS[task.task_id];
      if (!script) throw new Error(`runComputer: no pre-declared script for ${task.task_id}`);
      if (history.length >= script.length) throw new Error(`runComputer: script exhausted for ${task.task_id} at step ${history.length}`);
      return script[history.length];
    },
  },
};
const runOnce = async (runsPerTask) =>
  osw.run({ fixture: FIXTURE, split: 'mini', agent: osw.adapter({ mode: 'coords', computer: runComputer }), runsPerTask });
const r1 = await runOnce(1);
const r1b = await runOnce(1);
const r1c = await runOnce(1);
console.log(JSON.stringify(r1, null, 2));
const r5 = await runOnce(5);
const r5b = await runOnce(5);
const r5c = await runOnce(5);
const s1 = JSON.stringify(r1), s1b = JSON.stringify(r1b), s1c = JSON.stringify(r1c);
const s5 = JSON.stringify(r5), s5b = JSON.stringify(r5b), s5c = JSON.stringify(r5c);
check('P7.byte-identical-r1', s1 === s1b && s1b === s1c, `3 runs at runsPerTask=1 -> identical JSON (sha256/16 ${sha16(s1)}, ${sha16(s1b)}, ${sha16(s1c)})`);
check('P7.byte-identical-r5', s5 === s5b && s5b === s5c, `3 runs at runsPerTask=5 -> identical JSON (sha256/16 ${sha16(s5)}, ${sha16(s5b)}, ${sha16(s5c)})`);
check('P7.no-wallclock', !/Date\.now|Math\.random|new Date\(/.test(s1) && !/Date\.now|Math\.random|new Date\(/.test(s5), 'reports carry no wall-clock or randomness');
check('P7.passAt1-stable', r1.passAt1 === 0.75 && r5.passAt1 === 0.75, `pass@1 = 0.75 at runsPerTask=1 AND runsPerTask=5 (3 pass, 1 fail — averaging over runs does not move it)`);
check('P7.r1-perApp', j(r1.perApp) === j([
  { app: 'chrome', total: 1, passed: 1, rate: 1 },
  { app: 'gimp', total: 1, passed: 1, rate: 1 },
  { app: 'os', total: 1, passed: 1, rate: 1 },
  { app: 'multi_apps', total: 1, passed: 0, rate: 0 },
]), `perApp (frozen APPS order, instances = tasks x runs): ${j(r1.perApp)}`);
check('P7.r5-perApp', j(r5.perApp) === j([
  { app: 'chrome', total: 5, passed: 5, rate: 1 },
  { app: 'gimp', total: 5, passed: 5, rate: 1 },
  { app: 'os', total: 5, passed: 5, rate: 1 },
  { app: 'multi_apps', total: 5, passed: 0, rate: 0 },
]), `perApp at runsPerTask=5 counts task-run instances (4 tasks x 5 runs): ${j(r5.perApp)}`);
check('P7.perCategory', j(r5.perCategory) === j([
  { category: 'desktop', total: 5, passed: 5, rate: 1 },
  { category: 'file', total: 5, passed: 5, rate: 1 },
  { category: 'multi_app', total: 5, passed: 0, rate: 0 },
  { category: 'web', total: 5, passed: 5, rate: 1 },
]), `perCategory alphabetical: ${j(r5.perCategory)}`);
check('P7.runVerdicts', j(r5.perTask.map((t) => t.runVerdicts)) === j([[true, true, true, true, true], [true, true, true, true, true], [true, true, true, true, true], [false, false, false, false, false]]),
  'runVerdicts carries every run instance verdict; the stalled multi-app task fails all 5 runs');
check('P7.rejected-in-report', r1.rejected.length === 1 && r1.rejected[0].task_id === 'osw-mini-005' && r5.rejected.length === 1, 'the malformed entry stays surfaced in both reports (never silently dropped)');

/* ===================== P8 — no live VM, no Docker, no model =============== */
console.log('\n== P8: network grep on benchmarks/osworld/** — zero fetch/http outside the gated loader; no spawn; no VM/Docker/model deps ==');
const NET_RE = /fetch\s*\(|https?:\/\//;
const SPAWN_RE = /child_process|spawnSync|execFileSync|execSync|spawn\(|\bexec\(/;
const VM_DEPS_RE = /\bdocker\b|\bvirtualbox\b|\bvmware\b|\bqemu\b|\bpyautogui\b/i;
const FROM_RE = /(?<=[\s}])from\s*(['"])([^'"]+)\1/g; // import/export ... from 'spec' — the lookbehind keeps string literals like 'from' out
const IMP_RE = /\bimport\s*\(\s*(['"])([^'"]+)\1/g;
const files = ['tasks.js', 'adapter.js', 'observation.js', 'evaluator.js', 'report.js', 'index.js'].map((f) => path.join(OSW_DIR, f));
let outside = 0, inside = 0, spawns = 0;
const depHits = [];
const specifiers = new Set();
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split('\n');
  const rel = path.relative(ROOT, file);
  let lo = -1, hi = -1;
  lines.forEach((l, i) => {
    if (l.includes('// BEGIN OSW LIVE PATH')) lo = i;
    if (l.includes('// END OSW LIVE PATH')) hi = i;
  });
  lines.forEach((l, i) => {
    if (NET_RE.test(l)) {
      const inGated = rel.endsWith('tasks.js') && lo >= 0 && hi > lo && i > lo && i < hi;
      console.log(`  ${inGated ? 'GATED ' : 'AUDIT '} ${rel}:${i + 1}: ${l.trim().slice(0, 86)}`);
      if (inGated) inside += 1; else outside += 1;
    }
    if (SPAWN_RE.test(l)) { console.log(`  SPAWN  ${rel}:${i + 1}: ${l.trim().slice(0, 86)}`); spawns += 1; }
    if (VM_DEPS_RE.test(l)) depHits.push({ rel: rel, line: i + 1, comment: /^[/*]/.test(l.trim()) });
    for (const m of l.matchAll(FROM_RE)) specifiers.add(m[2]);
    for (const m of l.matchAll(IMP_RE)) specifiers.add(m[2]);
  });
}
check('P8.zero-outside-osw-path', outside === 0, `${outside} fetch/http hits outside the "// BEGIN/END OSW LIVE PATH" span (expected 0)`);
check('P8.osw-path-real', inside >= 3, `${inside} fetch/http hits inside the gated loader span (real 369-task set loader present, unreachable without allowNetwork:true)`);
check('P8.no-spawn-no-vm', spawns === 0, `${spawns} process-spawn primitives in the adapter (expected 0 — no VM launch, no Docker, no official-harness invocation)`);
const badDeps = depHits.filter((h) => !h.comment);
console.log(`  vm/docker words: ${depHits.length} hit(s)${depHits.map((h) => ` [${h.rel}:${h.line}${h.comment ? ' comment' : ' CODE'}]`).join('')}`);
check('P8.no-vm-deps', badDeps.length === 0, 'docker/virtualbox/vmware/qemu/pyautogui mentions in comments only — zero executable references (the adapter is a translator, not a VM stack)');
const foreign = [...specifiers].filter((s) => !s.startsWith('node:') && !s.startsWith('./') && !s.startsWith('../'));
console.log(`  imports: ${[...specifiers].sort().join(', ')}`);
check('P8.no-new-deps', foreign.length === 0, `all imports are node: builtins or local modules; foreign: ${j(foreign)}`);

/* ===================== P9 — zone check (PRE-commit) ======================= */
console.log('\n== P9 zone check: git status --porcelain ⊆ benchmarks/osworld/**, benchmarks/_fixtures/osworld/**, scripts/phase31-*.mjs ==');
const statusOut = execFileSync('git', ['status', '--porcelain', '-uall'], { cwd: ROOT }).toString().split('\n').filter(Boolean).sort();
console.log(statusOut.map((l) => `  ${l}`).join('\n'));
const zoneViolations = statusOut.filter((line) => {
  const file = line.slice(3).trim().replace(/^(.*) -> .*$/, '$1');
  if (file.startsWith('benchmarks/osworld/')) return false;
  if (file.startsWith('benchmarks/_fixtures/osworld/')) return false;
  if (/^scripts\/phase31-[\w.-]*\.mjs$/.test(file)) return false;
  return true;
});
check('P9.zone-clean', zoneViolations.length === 0, `${statusOut.length} entries, all inside the named call sites; violations: ${j(zoneViolations)}`);

/* ============================ summary ===================================== */
console.log(`\n== SUMMARY: ${n - FAILS.length}/${n} PASS ==`);
if (FAILS.length) { console.log('FAILURES:'); for (const f of FAILS) console.log(`  - ${f}`); }
process.exit(FAILS.length ? 1 : 0);

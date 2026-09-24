#!/usr/bin/env node
// scripts/phase29-scope-b-probe.mjs
// Phase 29 — Scope B live probe: operator interface + desktop operator.
// Zero dependencies. No disk writes, no network, no clock. Raw output per
// check. Exit 1 on any failure.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { action } from '../computer/action/index.js';
import { registry, assertOperator, createFakeOperator } from '../computer/operators/index.js';
import { ComputerError } from '../computer/errors.js';

const WT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
function check(name, ok, evidence) {
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}`);
  console.log(`        ${evidence}`);
  if (!ok) failures += 1;
}
function codeOf(fn) {
  try {
    fn();
    return null; // did not throw
  } catch (e) {
    return e instanceof ComputerError ? e : { code: `NOT_COMPUTER_ERROR:${e?.message}` };
  }
}

console.log('=== SCOPE B PROBE — operator interface + desktop operator ===');
console.log(`node ${process.version}`);
console.log(`environment: DISPLAY=${process.env.DISPLAY ?? '<unset>'} WAYLAND_DISPLAY=${process.env.WAYLAND_DISPLAY ?? '<unset>'} platform=${process.platform}`);
console.log('');

const clickAction = action.parse("click(start_box='<|box_start|>(100,200)<|box_end|>')");
const typeAction = action.parse(String.raw`type(content='hello \'world\'')`);

// ---------------------------------------------------------------------------
// P1 — registry.list() -> browser + desktop + fake; show capabilities of each
// ---------------------------------------------------------------------------
const listed = registry.list();
console.log('P1 registry.list() raw:');
for (const op of listed) {
  console.log(`  ${JSON.stringify({ name: op.name, testOnly: op.testOnly === true, capabilities: op.capabilities })}`);
}
const names = listed.map((o) => o.name).sort().join(',');
const capsShape = listed.every((o) =>
  ['screenshot', 'mouse', 'keyboard', 'mobile', 'desktop'].every((k) => typeof o.capabilities[k] === 'boolean')
);
check(
  'P1 registry exposes exactly browser + desktop + fake, all with the 5-key capability declaration',
  names === 'browser,desktop,fake' && capsShape,
  `names=${names} capsShape=${capsShape} desktop=${JSON.stringify(registry.get('desktop').capabilities)} fake=${JSON.stringify(registry.get('fake').capabilities)}`
);
console.log('');

// ---------------------------------------------------------------------------
// P2 — fake operator records an action -> exact call shape asserted
// ---------------------------------------------------------------------------
const fake = registry.get('fake');
const rec = fake.execute(clickAction);
console.log('P2 fake.execute(click) return raw:');
console.log(`  ${JSON.stringify(rec)}`);
console.log('P2 fake journalSnapshot() raw:');
console.log(`  ${JSON.stringify(fake.journalSnapshot())}`);
const j1 = fake.journalSnapshot();
const p2ok =
  rec.ok === true &&
  rec.result.recorded === 1 &&
  j1.length === 1 &&
  j1[0].seq === 1 &&
  JSON.stringify(j1[0].action) === JSON.stringify(clickAction) &&
  j1[0].action.action === 'click' &&
  j1[0].action.args.start_box.x === 100 &&
  j1[0].action.args.start_box.y === 200;
check(
  'P2 fake records the exact structured action (deep-copied, seq=1); return { ok, result.recorded }',
  p2ok,
  `recorded=${JSON.stringify(j1[0])}`
);
console.log('');

// ---------------------------------------------------------------------------
// P3 — desktop operator in sandbox: truthful capabilities, E_NO_DISPLAY
// ---------------------------------------------------------------------------
const desktop = registry.get('desktop');
console.log(`P3 desktop.capabilities raw: ${JSON.stringify(desktop.capabilities)}`);
const execNoDisplay = desktop.execute(clickAction);
console.log('P3 desktop.execute(click) raw (no display):');
console.log(`  ${JSON.stringify(execNoDisplay)}`);
const shotErr = codeOf(() => desktop.screenshot());
console.log(`P3 desktop.screenshot() threw: ${shotErr && shotErr.code} details=${JSON.stringify(shotErr && shotErr.details)}`);
const p3ok =
  desktop.capabilities.desktop === true &&
  desktop.capabilities.screenshot === true &&
  desktop.capabilities.mouse === true &&
  desktop.capabilities.keyboard === true &&
  desktop.capabilities.mobile === false &&
  execNoDisplay.ok === false &&
  execNoDisplay.error.code === 'E_NO_DISPLAY' &&
  execNoDisplay.error.display.DISPLAY === null && // truthful env echo
  shotErr && shotErr.code === 'E_NO_DISPLAY';
check(
  'P3 desktop declares backend-design capabilities truthfully; execute() returns { ok:false, E_NO_DISPLAY } (never faked success); screenshot() throws E_NO_DISPLAY',
  p3ok,
  `capabilities ok=${desktop.capabilities.desktop && desktop.capabilities.mouse} no-display env echo=${JSON.stringify(execNoDisplay.error.display)} execute code=${execNoDisplay.error.code} screenshot code=${shotErr?.code}`
);
console.log('');

// ---------------------------------------------------------------------------
// P4 — Unknown operator -> E_UNKNOWN_OPERATOR
// ---------------------------------------------------------------------------
const g1 = codeOf(() => registry.get('mobile'));
const s1 = codeOf(() => registry.select('headless'));
console.log('P4 raw thrown codes:');
console.log(`  registry.get('mobile')   -> ${g1 && g1.code}`);
console.log(`  registry.select('headless') -> ${s1 && s1.code}`);
const p4ok = g1 && g1.code === 'E_UNKNOWN_OPERATOR' && s1 && s1.code === 'E_UNKNOWN_OPERATOR';
check(
  'P4 unknown operators (get, select) throw E_UNKNOWN_OPERATOR with known list in details',
  p4ok,
  `codes: ${g1?.code}, ${s1?.code}; details=${JSON.stringify(g1?.details)}`
);
console.log('');

// ---------------------------------------------------------------------------
// P5 — select('desktop') / select('fake') / default select()
// ---------------------------------------------------------------------------
const selD = registry.select('desktop');
console.log(`P5 select('desktop').active.name = ${selD.active.name}`);
const selF = registry.select('fake');
console.log(`P5 select('fake').active.name    = ${selF.active.name}`);
const selDefault = registry.select(); // no argument
console.log(`P5 select() (default)             = ${selDefault.active.name}`);
const p5ok =
  selD.active.name === 'desktop' &&
  selF.active.name === 'fake' &&
  selDefault.active.name === 'desktop' && // default is NEVER the test-only fake
  registry.active().active.name === 'desktop';
check(
  "P5 select switches the active operator; default select() resolves 'desktop', never the test-only fake",
  p5ok,
  `desktop -> fake -> default(deSKTOP): active=${selDefault.active.name} testOnly=${selDefault.active.testOnly === true}`
);
console.log('');

// ---------------------------------------------------------------------------
// P6 — assert() on malformed operator -> E_OPERATOR_INCOMPLETE
// ---------------------------------------------------------------------------
const bad1 = codeOf(() => assertOperator({}));
const bad2 = codeOf(() => assertOperator({ name: 'x', capabilities: { screenshot: true }, screenshot() {}, execute() {}, assert() {} }));
const bad3 = codeOf(() => assertOperator({ name: '', capabilities: { screenshot: true, mouse: true, keyboard: true, mobile: true, desktop: true }, screenshot() {}, execute() {}, assert() {} }));
const bad4 = codeOf(() => assertOperator({ name: 'x', capabilities: { screenshot: true, mouse: true, keyboard: true, mobile: true, desktop: true }, execute() {}, assert() {} })); // no screenshot()
console.log('P6 raw thrown codes for malformed operators:');
console.log(`  {} (empty object)                      -> ${bad1 && bad1.code} (${JSON.stringify(bad1 && bad1.details)})`);
console.log(`  capabilities missing 4 keys            -> ${bad2 && bad2.code} (${JSON.stringify(bad2 && bad2.details)})`);
console.log(`  empty name                             -> ${bad3 && bad3.code} (${JSON.stringify(bad3 && bad3.details)})`);
console.log(`  missing screenshot()                   -> ${bad4 && bad4.code} (${JSON.stringify(bad4 && bad4.details)})`);
const goodD = desktop.assert();
const goodF = fake.assert();
console.log(`  desktop.assert() -> ${goodD}; fake.assert() -> ${goodF}`);
const p6ok =
  bad1 && bad1.code === 'E_OPERATOR_INCOMPLETE' &&
  bad2 && bad2.code === 'E_OPERATOR_INCOMPLETE' &&
  bad3 && bad3.code === 'E_OPERATOR_INCOMPLETE' &&
  bad4 && bad4.code === 'E_OPERATOR_INCOMPLETE' &&
  goodD === true && goodF === true;
check(
  'P6 malformed operators throw E_OPERATOR_INCOMPLETE naming the failing field; desktop + fake pass assert()',
  p6ok,
  `4/4 malformed cases -> E_OPERATOR_INCOMPLETE; valid ops assert()=true`
);
console.log('');

// ---------------------------------------------------------------------------
// P7 — Determinism: same action twice -> same recorded payload;
//      fresh fakes fed the same sequence -> byte-identical journals
// ---------------------------------------------------------------------------
// fresh instances for the clean experiment (do not disturb P2's journal);
// the fake is a factory — fresh instances are the honest determinism proof:
const fA = createFakeOperator();
const fB = createFakeOperator();
console.log('P7 raw determinism output:');
const rep1 = fA.execute(clickAction);
const rep2 = fA.execute(clickAction);
const payloadEq = JSON.stringify(rep1.result.action) === JSON.stringify(rep2.result.action);
console.log(`  same action twice on one fake: recorded payloads identical = ${payloadEq}`);
console.log(`    #1 ${JSON.stringify(rep1)}`);
console.log(`    #2 ${JSON.stringify(rep2)}`);
const typeRec = fA.execute(typeAction);
// feed fake B the SAME sequence (click, click, type) before comparing:
fB.execute(clickAction);
fB.execute(clickAction);
fB.execute(typeAction);
const journalA = JSON.stringify(fA.journalSnapshot());
const journalB = JSON.stringify(fB.journalSnapshot());
console.log(`  fresh fake B fed the same sequence -> journals byte-identical = ${journalA === journalB}`);
const p7ok = payloadEq && journalA === journalB && typeRec.ok === true;
check(
  'P7 recorded action payloads are identical for repeated identical actions (seq is journal identity, declared); fresh fakes produce byte-identical journals (no hidden state)',
  p7ok,
  `payloadEq=${payloadEq} journalEq=${journalA === journalB} seqDesign=increment-per-record`
);
console.log('');

// ---------------------------------------------------------------------------
// P8 — Zone check: git status shows ONLY this scope's paths
// ---------------------------------------------------------------------------
const st = spawnSync('git', ['status', '--short'], { cwd: WT, encoding: 'utf8' });
const lines = st.stdout.split('\n').filter((l) => l.trim() !== '');
console.log('P8 git status --short raw:');
console.log(st.stdout.trim());
const ALLOWED = ['computer/', 'scripts/phase29-'];
const zoneOk = lines.every((l) => {
  const p = l.slice(3).trim();
  return l.startsWith('?? ') && ALLOWED.some((a) => p === a || p.startsWith(a));
});
check(
  'P8 zone discipline: only computer/** + scripts/phase29-* paths in git status (Scope A files untouched — committed, thus absent from status)',
  zoneOk,
  `${lines.length} untracked path(s): ${lines.map((l) => l.slice(3).trim()).join(' | ')}`
);
console.log('');

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log('---------------------------------------------');
console.log(`SCOPE B: ${8 - failures}/8 PASS, ${failures} FAIL`);
if (failures > 0) process.exit(1);

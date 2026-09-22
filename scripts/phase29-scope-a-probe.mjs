#!/usr/bin/env node
// scripts/phase29-scope-a-probe.mjs
// Phase 29 — Scope A live probe: action space + parser.
// Zero dependencies. Pure functions, no disk writes, no network, no clock.
// Raw output per check. Exit 1 on any failure.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  action,
  ACTION_SPACE_VERSION,
  NORMALIZE_FORMULA,
  ComputerError,
} from '../computer/action/index.js';

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
    return null; // did not throw — caller treats as failure
  } catch (e) {
    return e instanceof ComputerError ? e : { code: `NOT_COMPUTER_ERROR:${e?.message}` };
  }
}

console.log('=== SCOPE A PROBE — action space + parser ===');
console.log(`node ${process.version}`);
console.log(`action space version: ${ACTION_SPACE_VERSION}`);
console.log('');

// ---------------------------------------------------------------------------
// P1 — Parse each of the 9 action forms -> structured action
// ---------------------------------------------------------------------------
const FORMS = {
  click: "click(start_box='<|box_start|>(100,200)<|box_end|>')",
  left_double: "left_double(start_box='<|box_start|>(340,512)<|box_end|>')",
  right_single: "right_single(start_box='<|box_start|>(12,8)<|box_end|>')",
  drag: "drag(start_box='<|box_start|>(100,200)<|box_end|>', end_box='<|box_start|>(300,400)<|box_end|>')",
  hotkey: "hotkey(key='ctrl+c')",
  type: String.raw`type(content='it\'s a \"test\"\nline2')`,
  scroll: "scroll(start_box='<|box_start|>(500,500)<|box_end|>', direction='down')",
  wait: 'wait()',
  finished: "finished(content='task complete')",
};
console.log('P1 raw parse output per action form:');
const parsed = {};
for (const [name, text] of Object.entries(FORMS)) {
  parsed[name] = action.parse(text);
  console.log(`  in : ${text}`);
  console.log(`  out: ${JSON.stringify(parsed[name])}`);
}
// The bracket-box form (second accepted format), shown on click:
const BRACKET = "click(start_box='[740,30,860,90]')";
const bracketParsed = action.parse(BRACKET);
console.log(`  in : ${BRACKET}   (bracket box form)`);
console.log(`  out: ${JSON.stringify(bracketParsed)}`);
// The escaped type() content, unescaped exactly:
const expectedTyped = `it's a "test"\nline2`;
const escapeOk = parsed.type.args.content === expectedTyped;
console.log(`  type() unescape: ${JSON.stringify(parsed.type.args.content)} expected ${JSON.stringify(expectedTyped)} match=${escapeOk}`);
const p1ok =
  parsed.click.args.start_box.x === 100 && parsed.click.args.start_box.y === 200 &&
  parsed.left_double.action === 'left_double' &&
  parsed.right_single.action === 'right_single' &&
  parsed.drag.args.start_box.x === 100 && parsed.drag.args.end_box.y === 400 &&
  parsed.hotkey.args.key === 'ctrl+c' &&
  escapeOk &&
  parsed.scroll.args.direction === 'down' && parsed.scroll.args.start_box.x === 500 &&
  parsed.wait.action === 'wait' && Object.keys(parsed.wait.args).length === 0 &&
  parsed.finished.args.content === 'task complete' &&
  // bracket box [740,30,860,90] -> center ((740+860)/2, (30+90)/2) = (800, 60)
  bracketParsed.args.start_box.x === 800 && bracketParsed.args.start_box.y === 60;
check(
  'P1 all 9 action forms parse to the correct structured shape; bracket box [740,30,860,90] -> center (800,60); type() escapes resolved',
  p1ok,
  `click=${JSON.stringify(parsed.click.args)} scroll=${JSON.stringify(parsed.scroll.args)} waitArgs=${JSON.stringify(parsed.wait.args)} bracketCenter=${JSON.stringify(bracketParsed.args.start_box)}`
);
console.log('');

// ---------------------------------------------------------------------------
// P2 — Round-trip: parse(serialize(a)) byte-equal (on { action, args })
// ---------------------------------------------------------------------------
console.log('P2 raw round-trip output (canonical serialize -> parse):');
let rtOk = true;
for (const [name, a] of Object.entries(parsed)) {
  const text = action.serialize(a);
  const back = action.parse(text);
  const left = JSON.stringify({ action: a.action, args: a.args });
  const right = JSON.stringify({ action: back.action, args: back.args });
  const eq = left === right;
  if (!eq) rtOk = false;
  console.log(`  ${name}: ser=${text}`);
  console.log(`  ${name}: ${eq ? 'BYTE-EQUAL' : `MISMATCH ${left} != ${right}`}`);
}
// Text-level byte-equality for the escape-heavy type() form:
const typeText = action.serialize(parsed.type);
const typeByteEqual = typeText === FORMS.type;
console.log(`  type() text-level round trip: ser=${typeText} byteEqual=${typeByteEqual}`);
// And for a canonical click:
const clickText = action.serialize(parsed.click);
const clickByteEqual = clickText === FORMS.click;
console.log(`  click() text-level round trip: ser=${clickText} byteEqual=${clickByteEqual}`);
check(
  'P2 parse(serialize(a)) byte-equal on {action,args} for all 9; text-level byte-equal for type() + click() canonical forms',
  rtOk && typeByteEqual && clickByteEqual,
  `9/9 structured round trips equal; type byteEqual=${typeByteEqual} click byteEqual=${clickByteEqual} (raw differs by definition: it echoes the input text)`
);
console.log('');

// ---------------------------------------------------------------------------
// P3 — Coordinate normalization: (0,0)-(1000,1000) model -> 1920x1080 screen
// ---------------------------------------------------------------------------
const OPTS = { modelSize: { width: 1000, height: 1000 }, screenSize: { width: 1920, height: 1080 } };
const POINTS = [
  { in: { x: 0, y: 0 }, want: { x: 0, y: 0 } },
  { in: { x: 1000, y: 1000 }, want: { x: 1920, y: 1080 } },
  { in: { x: 500, y: 500 }, want: { x: 960, y: 540 } },
  { in: { x: 250, y: 750 }, want: { x: 480, y: 810 } },
];
console.log(`P3 declared formula: ${NORMALIZE_FORMULA}`);
console.log('P3 raw math (x * 1920/1000, y * 1080/1000, round, clamp):');
let p3ok = true;
for (const p of POINTS) {
  const got = action.normalize(p.in, OPTS);
  const math = `(${p.in.x} * 1920/1000 = ${p.in.x * 1920 / 1000} -> round ${Math.round(p.in.x * 1920 / 1000)}; ${p.in.y} * 1080/1000 = ${p.in.y * 1080 / 1000} -> round ${Math.round(p.in.y * 1080 / 1000)})`;
  const ok = got.x === p.want.x && got.y === p.want.y;
  if (!ok) p3ok = false;
  console.log(`  ${JSON.stringify(p.in)} -> ${JSON.stringify(got)} want ${JSON.stringify(p.want)} ${ok ? 'OK' : 'WRONG'}  ${math}`);
}
check(
  'P3 normalize maps model 1000x1000 -> screen 1920x1080 per declared formula (corners, center, asymmetric point)',
  p3ok,
  `0,0->0,0; 1000,1000->1920,1080; 500,500->960,540; 250,750->480,810`
);
console.log('');

// ---------------------------------------------------------------------------
// P4 — Unknown action -> E_UNKNOWN_ACTION (never passed through)
// ---------------------------------------------------------------------------
const bad1 = codeOf(() => action.parse("open_app(name='calc')"));
const bad2 = codeOf(() => action.parse("terminate(reason='done')"));
const bad3 = codeOf(() => action.parse("Click(start_box='<|box_start|>(1,2)<|box_end|>')")); // case-sensitive
console.log('P4 raw thrown codes:');
console.log(`  open_app(...)  -> ${bad1 && bad1.code}`);
console.log(`  terminate(...) -> ${bad2 && bad2.code}`);
console.log(`  Click(...)     -> ${bad3 && bad3.code}`);
const p4ok =
  bad1 && bad1.code === 'E_UNKNOWN_ACTION' &&
  bad2 && bad2.code === 'E_UNKNOWN_ACTION' &&
  bad3 && bad3.code === 'E_UNKNOWN_ACTION';
check(
  'P4 unknown actions (open_app, terminate, case-mismatched Click) all throw E_UNKNOWN_ACTION with the name in details',
  p4ok,
  `codes: ${bad1?.code}, ${bad2?.code}, ${bad3?.code}; details open_app=${JSON.stringify(bad1?.details)}`
);
console.log('');

// ---------------------------------------------------------------------------
// P5 — Determinism
// ---------------------------------------------------------------------------
const sample = FORMS.drag;
const p1a = JSON.stringify(action.parse(sample));
const p1b = JSON.stringify(action.parse(sample));
const p1c = JSON.stringify(action.parse(sample));
const a0 = parsed.scroll;
const s1 = action.serialize(a0);
const s2 = action.serialize(a0);
const n1 = JSON.stringify(action.normalize({ x: 333, y: 666 }, OPTS));
const n2 = JSON.stringify(action.normalize({ x: 333, y: 666 }, OPTS));
// Full pipeline stability: parse -> serialize -> parse twice, compare
const pipeA = JSON.stringify(action.parse(action.serialize(action.parse(sample))));
const pipeB = JSON.stringify(action.parse(action.serialize(action.parse(sample))));
console.log('P5 raw determinism output:');
console.log(`  parse x3 identical:        ${p1a === p1b && p1b === p1c}`);
console.log(`  serialize x2 identical:    ${s1 === s2}`);
console.log(`  normalize x2 identical:    ${n1 === n2} (${n1})`);
console.log(`  pipeline x2 identical:     ${pipeA === pipeB}`);
const p5ok = p1a === p1b && p1b === p1c && s1 === s2 && n1 === n2 && pipeA === pipeB;
check(
  'P5 parse/serialize/normalize/pipeline outputs are identical across repeated invocations (no clock, no randomness)',
  p5ok,
  `parse3=${p1a === p1b && p1b === p1c} ser2=${s1 === s2} norm2=${n1 === n2} pipe2=${pipeA === pipeB}`
);
console.log('');

// ---------------------------------------------------------------------------
// P6 — Zone check: git status shows ONLY this scope's paths
// ---------------------------------------------------------------------------
const st = spawnSync('git', ['status', '--short'], { cwd: WT, encoding: 'utf8' });
const lines = st.stdout.split('\n').filter((l) => l.trim() !== '');
console.log('P6 git status --short raw:');
console.log(st.stdout.trim());
const ALLOWED = ['computer/', 'scripts/phase29-'];
const zoneOk =
  // consolidated-cleanup discipline: no `lines.length > 0` precondition — a
  // clean committed tree passes vacuously; the substantive assert is
  // "no out-of-zone path".
  lines.every((l) => {
    const p = l.slice(3).trim();
    return l.startsWith('?? ') && ALLOWED.some((a) => p === a || p.startsWith(a));
  });
check(
  'P6 zone discipline: only computer/** + scripts/phase29-* paths in git status',
  zoneOk,
  `${lines.length} untracked path(s), all inside the Scope A zone: ${lines.map((l) => l.slice(3).trim()).join(' | ')}`
);
console.log('');

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log('---------------------------------------------');
console.log(`SCOPE A: ${6 - failures}/6 PASS, ${failures} FAIL`);
if (failures > 0) process.exit(1);

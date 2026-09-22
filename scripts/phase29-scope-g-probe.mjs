#!/usr/bin/env node
// scripts/phase29-scope-g-probe.mjs
// Phase 29 — Scope G live probe: agent modes (omni / gui / game).
// Zero dependencies, zero network: pure declarative policy over frozen
// tables (computer/modes). Raw output per check. Exit 1 on any failure.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  modes,
  TOOL_ORDER,
  MODE_CODES,
  AGENT_MODE_SCHEMA,
} from '../computer/modes/index.js';
import { ComputerError } from '../computer/errors.js';

const WT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
function check(name, ok, evidence) {
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}`);
  console.log(`        ${evidence}`);
  if (!ok) failures += 1;
}

// Catch a thrown failure and surface its ComputerError code (or a marker
// for non-ComputerError escapes — which would itself be a violation).
function codeOf(fn) {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof ComputerError ? e.code : `NON_COMPUTER_ERROR:${e && e.constructor && e.constructor.name}`;
  }
}

// Fixed-order allowed() matrix over the closed tool catalog. Key order is
// TOOL_ORDER (catalog declaration order) so JSON.stringify is byte-stable.
function matrixSnapshot() {
  const m = {};
  for (const t of TOOL_ORDER) m[t] = modes.allowed(t);
  return m;
}
function matrixStr() {
  return JSON.stringify(matrixSnapshot());
}

// Expected matrices, derived from the lead-declared restrictions only:
//   omni  -> everything allowed
//   gui   -> GUI family (Scope A nine + browser navigate/navigate_back),
//            no bash, no mcp
//   game  -> Scope A nine only (navigate/navigate_back removed), no bash,
//            no mcp
const GUI_CORE = ['click', 'left_double', 'right_single', 'drag', 'hotkey', 'type', 'scroll', 'wait', 'finished'];
function expectMap(mode) {
  const m = {};
  for (const t of GUI_CORE) m[t] = true;
  m.navigate = mode !== 'game';
  m.navigate_back = mode !== 'game';
  m.bash = mode === 'omni';
  m.mcp = mode === 'omni';
  return m;
}
const EXPECT = { omni: expectMap('omni'), gui: expectMap('gui'), game: expectMap('game') };

console.log('=== SCOPE G PROBE — agent modes (omni / gui / game) ===');
console.log(`node ${process.version}`);
console.log(`declared schema: ${JSON.stringify(AGENT_MODE_SCHEMA)}`);
console.log(`declared codes: ${MODE_CODES.join(' | ')} (ComputerError; E_INVALID_ARGUMENT reused for opts misuse — no new class)`);
console.log(`closed tool catalog (${TOOL_ORDER.length}): ${TOOL_ORDER.join(', ')}`);
console.log('network: none — declarative policy only; deterministic (no clock, no randomness); validation order unknown-mode -> loop-active -> opts');
console.log('');

// ---------------------------------------------------------------------------
// P1 — list() shows the 3 declared modes with descriptions. Also: the
//      schema default before any set() is { id: 'omni', opts: {} }.
// ---------------------------------------------------------------------------
const list = modes.list();
const activeDefault = modes.active();
console.log(`P1 list raw: ${JSON.stringify(list)}`);
console.log(`P1 default active raw: ${JSON.stringify(activeDefault)} (schema default, no set() called yet)`);
const p1ok =
  Array.isArray(list) && list.length === 3 &&
  JSON.stringify(list.map((m) => m.id)) === JSON.stringify(['omni', 'gui', 'game']) &&
  list.every((m) => typeof m.description === 'string' && m.description.length > 0) &&
  list.every((m) => JSON.stringify(Object.keys(m)) === JSON.stringify(['id', 'description'])) &&
  activeDefault.id === AGENT_MODE_SCHEMA.default && JSON.stringify(activeDefault.opts) === '{}';
check(
  'P1 list(): exactly the three declared modes in schema declaration order (omni, gui, game), each carrying a non-empty description, shape exactly { id, description }; before any set() the active mode is the schema default { omni, {} }',
  p1ok,
  `ids=${JSON.stringify(list.map((m) => m.id))} descriptions=${JSON.stringify(list.map((m) => m.description))} default=${JSON.stringify(activeDefault)}`
);
console.log('');

// ---------------------------------------------------------------------------
// P2 — set('gui') -> allowed('bash') false, allowed('click') true; show the
//      full gui allowed-action matrix.
// ---------------------------------------------------------------------------
const setGui = modes.set('gui');
console.log(`P2 set raw: ${JSON.stringify(setGui)} active=${JSON.stringify(modes.active())}`);
console.log(`P2 gui matrix raw: ${matrixStr()}`);
const p2ok =
  setGui.mode === 'gui' &&
  modes.allowed('bash') === false && modes.allowed('click') === true &&
  matrixStr() === JSON.stringify(EXPECT.gui) &&
  modes.active().id === 'gui' && JSON.stringify(modes.active().opts) === '{}';
check(
  'P2 gui mode: bash=false (no shell), click=true (GUI family); full matrix matches the declared gui toolset — Scope A nine + navigate/navigate_back allowed, bash + mcp refused',
  p2ok,
  `set=${JSON.stringify(setGui)} bash=${modes.allowed('bash')} click=${modes.allowed('click')} matrix=${matrixStr()}`
);
console.log('');

// ---------------------------------------------------------------------------
// P3 — set('game', { link: 'https://example.test' }) -> navigate blocked,
//      preset link stored; show the game matrix + opts. Sub-check: game
//      without the required link is refused with the reused
//      E_INVALID_ARGUMENT and changes nothing (REPLACE semantics).
// ---------------------------------------------------------------------------
const setGame = modes.set('game', { link: 'https://example.test' });
console.log(`P3 set raw: ${JSON.stringify(setGame)} active=${JSON.stringify(modes.active())}`);
console.log(`P3 game matrix raw: ${matrixStr()}`);
const gameNoLinkCode = codeOf(() => modes.set('game'));
console.log(`P3 game-without-link raw: set('game') -> ${gameNoLinkCode} active-unchanged=${JSON.stringify(modes.active())}`);
const p3ok =
  setGame.mode === 'game' &&
  modes.allowed('navigate') === false && modes.allowed('navigate_back') === false &&
  modes.allowed('bash') === false && modes.allowed('mcp') === false &&
  modes.active().id === 'game' && modes.active().opts.link === 'https://example.test' &&
  matrixStr() === JSON.stringify(EXPECT.game) &&
  gameNoLinkCode === 'E_INVALID_ARGUMENT' &&
  modes.active().id === 'game' && modes.active().opts.link === 'https://example.test';
check(
  'P3 game mode: navigate + navigate_back are blocked (and bash/mcp stay blocked); the preset link is stored verbatim in active().opts; the full matrix matches the declared game toolset (Scope A nine only); re-setting game without the required link is refused E_INVALID_ARGUMENT and the stored mode + link survive unchanged',
  p3ok,
  `set=${JSON.stringify(setGame)} opts=${JSON.stringify(modes.active().opts)} navigate=${modes.allowed('navigate')} navigateBack=${modes.allowed('navigate_back')} matrix=${matrixStr()} noLinkCode=${gameNoLinkCode}`
);
console.log('');

// ---------------------------------------------------------------------------
// P4 — change mode while a loop is active -> E_LOOP_ACTIVE. The active-loop
//      flag is simulated through the declared loop-integration seam
//      (modes.setLoopActive — the seam a Scope F-shaped loop holds at
//      runtime; paused counts as active). Show the refusal, that the active
//      mode survives it, that a same-mode re-set is refused too, and the
//      recovery once the loop clears.
// ---------------------------------------------------------------------------
const loopOn = modes.setLoopActive(true);
const refusedOmni = codeOf(() => modes.set('omni'));
const refusedSameMode = codeOf(() => modes.set('game', { link: 'https://example.test' }));
const survived = modes.active();
console.log(`P4 refusal raw: loopActive=${modes.loopActive()} set('omni')->${refusedOmni} set('game',...)->${refusedSameMode} active-survived=${JSON.stringify(survived)}`);
const loopOff = modes.setLoopActive(false);
const afterSet = modes.set('omni');
console.log(`P4 recovery raw: loopActive=${modes.loopActive()} set=${JSON.stringify(afterSet)} active=${JSON.stringify(modes.active())}`);
const p4ok =
  loopOn.loopActive === true &&
  refusedOmni === 'E_LOOP_ACTIVE' && refusedSameMode === 'E_LOOP_ACTIVE' &&
  survived.id === 'game' && survived.opts.link === 'https://example.test' &&
  loopOff.loopActive === false &&
  afterSet.mode === 'omni' && modes.active().id === 'omni';
check(
  'P4 E_LOOP_ACTIVE: with the loop flag set, BOTH a cross-mode change (omni) and a same-mode re-set (game) are refused with E_LOOP_ACTIVE; the active mode + stored opts survive the refusals untouched; clearing the flag makes the next set() succeed',
  p4ok,
  `refusedOmni=${refusedOmni} refusedSameMode=${refusedSameMode} survived=${JSON.stringify(survived)} afterClear=${JSON.stringify(afterSet)}`
);
console.log('');

// ---------------------------------------------------------------------------
// P5 — unknown mode -> E_UNKNOWN_AGENT_MODE (string, empty string, and
//      non-string ids all outside the closed set); active mode unchanged.
// ---------------------------------------------------------------------------
const u1 = codeOf(() => modes.set('nope'));
const u2 = codeOf(() => modes.set(''));
const u3 = codeOf(() => modes.set(123));
console.log(`P5 raw: set('nope')->${u1} set('')->${u2} set(123)->${u3} active=${JSON.stringify(modes.active())}`);
const p5ok =
  u1 === 'E_UNKNOWN_AGENT_MODE' && u2 === 'E_UNKNOWN_AGENT_MODE' && u3 === 'E_UNKNOWN_AGENT_MODE' &&
  modes.active().id === 'omni';
check(
  'P5 E_UNKNOWN_AGENT_MODE: unknown id, empty id, and non-string id are all refused with E_UNKNOWN_AGENT_MODE (closed set: omni | gui | game); the active mode is unchanged by the refusals',
  p5ok,
  `nope=${u1} empty=${u2} nonString=${u3} active=${JSON.stringify(modes.active().id)}`
);
console.log('');

// ---------------------------------------------------------------------------
// P6 — set('omni') -> all tools allowed; show the full omni matrix.
// ---------------------------------------------------------------------------
const setOmni = modes.set('omni');
console.log(`P6 set raw: ${JSON.stringify(setOmni)} active=${JSON.stringify(modes.active())}`);
console.log(`P6 omni matrix raw: ${matrixStr()}`);
const p6ok =
  setOmni.mode === 'omni' &&
  TOOL_ORDER.every((t) => modes.allowed(t) === true) &&
  Object.keys(matrixSnapshot()).length === TOOL_ORDER.length;
check(
  `P6 omni mode: every tool in the closed catalog (${TOOL_ORDER.length} tools) is allowed — the full omni matrix is all-true`,
  p6ok,
  `set=${JSON.stringify(setOmni)} matrix=${matrixStr()}`
);
console.log('');

// ---------------------------------------------------------------------------
// P7 — determinism: same set + same action twice -> byte-identical
//      allowed() results. For each mode: set, snapshot (matrix + active)
//      twice, compare bytes; also compare against the matrices already
//      shown in P2/P3/P6 (cross-section byte equality).
// ---------------------------------------------------------------------------
const seq = [
  ['omni', undefined],
  ['gui', undefined],
  ['game', { link: 'https://example.test' }],
];
const snaps = {};
for (const [m, opts] of seq) {
  modes.set(m, opts);
  snaps[m] = {
    a: { matrix: matrixStr(), active: JSON.stringify(modes.active()) },
    b: { matrix: matrixStr(), active: JSON.stringify(modes.active()) },
  };
  console.log(`P7 ${m} snapshot-a raw: ${snaps[m].a.matrix} active=${snaps[m].a.active}`);
  console.log(`P7 ${m} snapshot-b raw: ${snaps[m].b.matrix} active=${snaps[m].b.active}`);
}
const hashes = {};
for (const m of ['omni', 'gui', 'game']) {
  hashes[m] = createHash('sha256').update(snaps[m].a.matrix).digest('hex').slice(0, 16);
}
console.log(`P7 sha256(matrix) raw: omni=${hashes.omni} gui=${hashes.gui} game=${hashes.game}`);
const pairIdentical = (m) => snaps[m].a.matrix === snaps[m].b.matrix && snaps[m].a.active === snaps[m].b.active;
const p7ok =
  pairIdentical('omni') && pairIdentical('gui') && pairIdentical('game') &&
  snaps.omni.a.matrix === JSON.stringify(EXPECT.omni) &&
  snaps.gui.a.matrix === JSON.stringify(EXPECT.gui) &&
  snaps.game.a.matrix === JSON.stringify(EXPECT.game) &&
  snaps.game.a.active === JSON.stringify({ id: 'game', opts: { link: 'https://example.test' } });
check(
  'P7 determinism: for each mode, two consecutive snapshots of allowed() over the full catalog plus active() are byte-identical; every snapshot also equals the matrix already shown in P2/P3/P6 — same set + same action always yields the same bytes',
  p7ok,
  `omni=${pairIdentical('omni')} gui=${pairIdentical('gui')} game=${pairIdentical('game')} sha256[16]={omni:${hashes.omni},gui:${hashes.gui},game:${hashes.game}}`
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
  const status = l.slice(0, 2); // '??', ' M', 'A ', ... — in-zone entries are legitimate
  const p = l.slice(3).trim();
  return ALLOWED.some((a) => p === a || p.startsWith(a)) && status.trim().length > 0;
});
check(
  'P8 zone discipline: only computer/** + scripts/phase29-* in git status (no Scope A-F file touched)',
  zoneOk,
  `${lines.length} path(s): ${lines.map((l) => l.slice(3).trim()).join(' | ')}`
);
console.log('');

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log('---------------------------------------------');
console.log(`SCOPE G: ${8 - failures}/8 PASS, ${failures} FAIL`);
if (failures > 0) process.exit(1);

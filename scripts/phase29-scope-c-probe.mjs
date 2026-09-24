#!/usr/bin/env node
// scripts/phase29-scope-c-probe.mjs
// Phase 29 — Scope C live probe: browser operator (CDP) + hybrid strategy.
// Zero dependencies. Fake CDP backend, fake Phase 17 adapter, fake VLM —
// all recording, all deterministic, all labeled test-only. Raw output per
// check. Exit 1 on any failure.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { action } from '../services/computer/action/index.js';
import { registry, createBrowserOperator, createFakeOperator } from '../services/computer/operators/index.js';
import { ComputerError } from '../services/computer/errors.js';
import { browserModeIds, DEFAULT_BROWSER_MODE, BROWSER_MODES } from '../services/computer/operators/browser-modes.js';

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
    return null;
  } catch (e) {
    return e instanceof ComputerError ? e : { code: `NOT_COMPUTER_ERROR:${e?.message}` };
  }
}

// ---------------------------------------------------------------------------
// Deterministic fake CDP backend (records every call; labeled test-only)
// ---------------------------------------------------------------------------
function makeFakeBackend() {
  const calls = [];
  return {
    testOnly: true,
    calls,
    callLog() { return JSON.parse(JSON.stringify(calls)); },
    screenshot() {
      calls.push({ op: 'screenshot', args: [] });
      return { image: 'FAKE-CDP-SHOT-8x6-test-only-marker', width: 8, height: 6, dpi: 96 };
    },
    click(pt) { calls.push({ op: 'click', args: [pt] }); return { clicked: pt }; },
    doubleClick(pt) { calls.push({ op: 'doubleClick', args: [pt] }); return { doubleClicked: pt }; },
    rightClick(pt) { calls.push({ op: 'rightClick', args: [pt] }); return { rightClicked: pt }; },
    drag(from, to) { calls.push({ op: 'drag', args: [from, to] }); return { dragged: [from, to] }; },
    scroll(pt, direction) { calls.push({ op: 'scroll', args: [pt, direction] }); return { scrolled: { pt, direction } }; },
    type(text) { calls.push({ op: 'type', args: [text] }); return { typed: text }; },
    key(key) { calls.push({ op: 'key', args: [key] }); return { keyed: key }; },
  };
}

// Deterministic fake Phase 17 DOM runtime adapter (records execute calls;
// confirmAt answers come from a scripted queue). Echoes the BrowserRouter
// worker protocol shape { execute(op, params) }.
function makeFakePhase17(confirmQueue) {
  const execCalls = [];
  const confirms = [...confirmQueue];
  return {
    testOnly: true,
    execCalls,
    confirmCalls: [],
    name() { return 'fake-phase17-BrowserRouter-adapter'; },
    execute(op, params) {
      execCalls.push({ op, params });
      return { ok: true, via: 'fake-phase17' };
    },
    confirmAt(pt) {
      const answer = confirms.length > 0 ? confirms.shift() : { found: false };
      this.confirmCalls.push({ at: pt, answer });
      return answer;
    },
  };
}

// Deterministic fake VLM (scripted prediction queue; Scope E ships the real seam).
function makeFakeVlm(predictions) {
  const inferCalls = [];
  const queue = [...predictions];
  return {
    testOnly: true,
    inferCalls,
    available() { return { available: true, model: 'stub-vlm-test-only' }; },
    infer({ image, instruction }) {
      const prediction = queue.length > 0 ? queue.shift() : queue[queue.length - 1] ?? '';
      inferCalls.push({ image, instruction, prediction });
      return { raw: prediction, prediction };
    },
  };
}

const PREDICT_55_66 = "click(start_box='<|box_start|>(55,66)<|box_end|>')";
const PREDICT_77_88 = "click(start_box='<|box_start|>(77,88)<|box_end|>')";
const clickAction = action.parse("click(start_box='<|box_start|>(100,200)<|box_end|>')");

function freshSetup({ predictions, confirmQueue }) {
  const op = createBrowserOperator();
  const backend = makeFakeBackend();
  const dom = makeFakePhase17(confirmQueue ?? []);
  const vlm = makeFakeVlm(predictions ?? []);
  op.attachBackend(backend).setDomRuntime(dom).setVlm(vlm);
  return { op, backend, dom, vlm };
}

console.log('=== SCOPE C PROBE — browser operator (CDP) + hybrid strategy ===');
console.log(`node ${process.version}`);
console.log(`declared modes: ${browserModeIds().join(' | ')} (default: ${DEFAULT_BROWSER_MODE})`);
console.log('');

// ---------------------------------------------------------------------------
// P1 — registry.list() includes 'browser'; capabilities.browser true
// ---------------------------------------------------------------------------
const browser = registry.get('browser');
const allNames = registry.list().map((o) => o.name).sort().join(',');
console.log(`P1 registry.list() names: ${allNames}`);
console.log(`P1 browser.capabilities raw: ${JSON.stringify(browser.capabilities)}`);
const capsOk =
  browser.capabilities.browser === true &&
  browser.capabilities.screenshot === true &&
  browser.capabilities.mouse === true &&
  browser.capabilities.keyboard === true &&
  browser.capabilities.mobile === false &&
  browser.capabilities.desktop === false;
check(
  "P1 registry includes 'browser' (desktop, fake, browser); capabilities carry browser:true with mobile/desktop false",
  allNames === 'browser,desktop,fake' && capsOk,
  `names=${allNames} capabilities=${JSON.stringify(browser.capabilities)}`
);
console.log('');

// ---------------------------------------------------------------------------
// P2 — setMode each of 3; mode() returns the set value; unknown -> throw
// ---------------------------------------------------------------------------
const op2 = createBrowserOperator();
console.log(`P2 initial mode(): ${op2.mode()} (declared default)`);
const m1 = op2.setMode('dom');
console.log(`P2 setMode('dom') -> mode()=${op2.mode()}`);
const m2 = op2.setMode('visual-grounding');
console.log(`P2 setMode('visual-grounding') -> mode()=${op2.mode()}`);
const m3 = op2.setMode('hybrid');
console.log(`P2 setMode('hybrid') -> mode()=${op2.mode()}`);
const badMode = codeOf(() => op2.setMode('wat'));
console.log(`P2 setMode('wat') threw: ${badMode && badMode.code} details=${JSON.stringify(badMode && badMode.details)}`);
const declaredDescriptions = Object.values(BROWSER_MODES).map((m) => `${m.id}: ${m.description}`).join(' ; ');
console.log(`P2 declared strategies: ${declaredDescriptions}`);
const p2ok =
  op2.mode() === 'hybrid' && m1 === 'dom' && m2 === 'visual-grounding' && m3 === 'hybrid' &&
  DEFAULT_BROWSER_MODE === 'hybrid' &&
  badMode && badMode.code === 'E_UNKNOWN_BROWSER_MODE';
check(
  'P2 all 3 declared modes set and read back; default is hybrid; unknown mode throws E_UNKNOWN_BROWSER_MODE',
  p2ok,
  `dom -> visual-grounding -> hybrid cycled; badMode=${badMode?.code}`
);
console.log('');

// ---------------------------------------------------------------------------
// P3 — dom mode delegates to the Phase 17 runtime (call trace proves it)
// ---------------------------------------------------------------------------
const s3 = freshSetup({});
s3.op.setMode('dom');
const r3a = s3.op.execute(clickAction);
const r3b = s3.op.execute(action.parse(String.raw`type(content='hello')`));
console.log('P3 dom-mode results raw:');
console.log(`  click: ${JSON.stringify(r3a)}`);
console.log(`  type : ${JSON.stringify(r3b)}`);
console.log(`P3 fake Phase 17 adapter execCalls (the delegation trace): ${JSON.stringify(s3.dom.execCalls)}`);
console.log(`P3 fake CDP backend callLog (must NOT contain the click): ${JSON.stringify(s3.backend.callLog())}`);
const traceOk =
  JSON.stringify(s3.dom.execCalls) === JSON.stringify([
    { op: 'click', params: { point: { x: 100, y: 200 } } },
    { op: 'type', params: { text: 'hello' } },
  ]);
const p3ok =
  r3a.ok === true && r3a.result.executed === 'dom-runtime' &&
  r3b.ok === true && r3b.result.executed === 'dom-runtime' &&
  traceOk &&
  !s3.backend.callLog().some((c) => c.op === 'click');
check(
  'P3 dom mode routes click+type through the Phase 17 adapter (exact call trace); CDP backend click untouched',
  p3ok,
  `execCalls=${JSON.stringify(s3.dom.execCalls)} backendClickCalls=${s3.backend.callLog().filter((c) => c.op === 'click').length}`
);
console.log('');

// ---------------------------------------------------------------------------
// P4 — visual-grounding: screenshot -> VLM (injected stub) -> coordinate op
// ---------------------------------------------------------------------------
const s4 = freshSetup({ predictions: [PREDICT_55_66] });
s4.op.setMode('visual-grounding');
const r4 = s4.op.execute(clickAction);
console.log('P4 visual-grounding result raw:');
console.log(`  ${JSON.stringify(r4)}`);
console.log(`P4 VLM inferCalls trace: ${JSON.stringify(s4.vlm.inferCalls)}`);
console.log(`P4 CDP backend callLog: ${JSON.stringify(s4.backend.callLog())}`);
const orderOk =
  s4.backend.callLog()[0]?.op === 'screenshot' &&
  s4.vlm.inferCalls.length === 1 &&
  s4.backend.callLog().some((c) => c.op === 'click' && JSON.stringify(c.args) === JSON.stringify([{ x: 55, y: 66 }]));
const p4ok =
  r4.ok === true && r4.result.executed === 'coordinate' && r4.result.point.x === 55 && r4.result.point.y === 66 && orderOk;
check(
  'P4 visual-grounding: screenshot first, VLM stub consulted (instruction + image echoed), coordinate click at the VLM-grounded point (55,66)',
  p4ok,
  `trace order screenshot->infer->click(${JSON.stringify(s4.backend.callLog().map((c) => c.op))}); point=${JSON.stringify(r4.result?.point)}`
);
console.log('');

// ---------------------------------------------------------------------------
// P5 — hybrid: DOM-confirm path AND coordinate-fallback path
// ---------------------------------------------------------------------------
const s5 = freshSetup({ predictions: [PREDICT_77_88, PREDICT_77_88], confirmQueue: [{ found: true, tag: 'button', text: 'Submit' }] });
s5.op.setMode('hybrid');
const r5dom = s5.op.execute(clickAction);
console.log('P5 hybrid DOM-confirm result raw:');
console.log(`  ${JSON.stringify(r5dom)}`);
const s5b = freshSetup({ predictions: [PREDICT_77_88], confirmQueue: [{ found: false }] });
s5b.op.setMode('hybrid');
const r5fb = s5b.op.execute(clickAction);
console.log('P5 hybrid fallback result raw (no DOM match):');
console.log(`  ${JSON.stringify(r5fb)}`);
const domPathOk =
  r5dom.ok === true && r5dom.result.executed === 'dom-runtime' &&
  r5dom.result.confirmed.found === true && r5dom.result.confirmed.tag === 'button' &&
  s5.dom.execCalls.length === 1 && s5.dom.execCalls[0].op === 'click' &&
  JSON.stringify(s5.dom.execCalls[0].params) === JSON.stringify({ point: { x: 77, y: 88 } }) &&
  !s5.backend.callLog().some((c) => c.op === 'click');
const fbPathOk =
  r5fb.ok === true && r5fb.result.executed === 'coordinate-fallback' &&
  r5fb.result.confirmed.found === false &&
  s5b.backend.callLog().some((c) => c.op === 'click' && JSON.stringify(c.args) === JSON.stringify([{ x: 77, y: 88 }])) &&
  s5b.dom.execCalls.length === 0;
check(
  'P5 hybrid: DOM match -> dom-runtime click at VLM point (no backend click); no match -> coordinate-fallback via CDP backend (no dom execute)',
  domPathOk && fbPathOk,
  `domPath=${domPathOk} (execCalls=${JSON.stringify(s5.dom.execCalls)}) fallbackPath=${fbPathOk} (backend click args=${JSON.stringify(s5b.backend.callLog().filter((c) => c.op === 'click').map((c) => c.args))})`
);
console.log('');

// ---------------------------------------------------------------------------
// P6 — sandbox without browser: E_NO_BROWSER, no success faked
// ---------------------------------------------------------------------------
const naked = createBrowserOperator(); // no backend, no runtime, no VLM
const shotErr = codeOf(() => naked.screenshot());
const execRes = naked.execute(clickAction);
console.log(`P6 screenshot() threw: ${shotErr && shotErr.code}`);
console.log(`P6 execute() raw: ${JSON.stringify(execRes)}`);
const modeErrDom = (() => { const o = createBrowserOperator().attachBackend(makeFakeBackend()); o.setMode('dom'); return o.execute(clickAction); })(); // backend present, Phase 17 adapter missing
console.log(`P6 dom mode without runtime -> ${JSON.stringify(modeErrDom)}`);
const modeErrVlm = (() => { const o = freshSetup({}); o.op.setMode('visual-grounding'); o.op.setVlm({ available() { return { available: false }; }, infer() { throw new Error('must not be called'); } }); return o.op.execute(clickAction); })();
console.log(`P6 visual mode with unavailable VLM -> ${JSON.stringify(modeErrVlm)}`);
const p6ok =
  shotErr && shotErr.code === 'E_NO_BROWSER' &&
  execRes.ok === false && execRes.error.code === 'E_NO_BROWSER' &&
  modeErrDom.ok === false && modeErrDom.error.code === 'E_DOM_RUNTIME_UNAVAILABLE' &&
  modeErrVlm.ok === false && modeErrVlm.error.code === 'E_VLM_UNAVAILABLE';
check(
  'P6 no backend -> E_NO_BROWSER on both paths; per-mode dependency gaps surface truthfully (E_DOM_RUNTIME_UNAVAILABLE / E_VLM_UNAVAILABLE)',
  p6ok,
  `screenshot=${shotErr?.code} execute=${execRes.error?.code} dom=${modeErrDom.error?.code} vlm=${modeErrVlm.error?.code}`
);
console.log('');

// ---------------------------------------------------------------------------
// P7 — Determinism: same action through identical fresh setups ->
//      byte-identical traces (hybrid DOM path)
// ---------------------------------------------------------------------------
const a1 = freshSetup({ predictions: [PREDICT_55_66], confirmQueue: [{ found: true, tag: 'button' }] });
const a2 = freshSetup({ predictions: [PREDICT_55_66], confirmQueue: [{ found: true, tag: 'button' }] });
a1.op.setMode('hybrid');
a2.op.setMode('hybrid');
a1.op.execute(clickAction);
a2.op.execute(clickAction);
const t1 = JSON.stringify({ backend: a1.backend.callLog(), dom: a1.dom.execCalls, vlm: a1.vlm.inferCalls, result: a1.op.execute(action.parse("wait()")) });
const t2 = JSON.stringify({ backend: a2.backend.callLog(), dom: a2.dom.execCalls, vlm: a2.vlm.inferCalls, result: a2.op.execute(action.parse("wait()")) });
console.log('P7 setup #1 trace raw:');
console.log(`  ${t1}`);
console.log(`P7 setup #2 trace raw:`);
console.log(`  ${t2}`);
console.log(`P7 byte-identical: ${t1 === t2}`);
// and through the fake operator for completeness:
const f1 = createFakeOperator();
const f2 = createFakeOperator();
f1.execute(clickAction); f2.execute(clickAction);
const fakeEq = JSON.stringify(f1.journalSnapshot()) === JSON.stringify(f2.journalSnapshot());
console.log(`P7 fake-operator journal equality (control): ${fakeEq}`);
check(
  'P7 identical fresh hybrid setups produce byte-identical call traces (backend + DOM adapter + VLM); fake operator control equal',
  t1 === t2 && fakeEq,
  `traceEq=${t1 === t2} fakeEq=${fakeEq}`
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
  const status = l.slice(0, 2); // '??', ' M', 'A ', ... — in-zone modifications are legitimate
  const p = l.slice(3).trim();
  return ALLOWED.some((a) => p === a || p.startsWith(a)) && status.trim().length > 0;
});
check(
  'P8 zone discipline: only computer/** + scripts/phase29-* in git status (index.js extension shows as modified file within computer/)',
  zoneOk,
  `${lines.length} path(s): ${lines.map((l) => l.slice(3).trim()).join(' | ')}`
);
console.log('');

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log('---------------------------------------------');
console.log(`SCOPE C: ${8 - failures}/8 PASS, ${failures} FAIL`);
if (failures > 0) process.exit(1);

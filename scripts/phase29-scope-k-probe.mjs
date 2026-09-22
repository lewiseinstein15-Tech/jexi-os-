#!/usr/bin/env node
// scripts/phase29-scope-k-probe.mjs
// Phase 29 — Scope K live probe: event stream integration (Phase 16).
// Zero dependencies, zero network: the VLM is a createVlm over an injected
// recording stub client (test-only), the operator is the Scope B fake, the
// capture source is a probe-local fixture PNG source (test-only). Phase 16
// taxonomy + router are consumed READ-ONLY (imports; no Phase 16 file is
// edited — P6 proves it with git diff). Raw output per check. Exit 1 on any
// failure.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { events, map, emit, GUI_EVENT_KINDS, MAP_TABLE } from '../computer/events/index.js';
import { taxonomy } from '../events/chat/taxonomy.js';
import {
  subscribe,
  history,
  handlerLog,
  _reset,
} from '../ui/web/console/chat/router.js';
import { createGuiAgent } from '../computer/loop/index.js';
import { createVlm } from '../computer/vlm/index.js';
import { createFakeOperator } from '../computer/operators/index.js';
import { ComputerError } from '../computer/errors.js';

const WT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
function check(name, ok, evidence) {
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}`);
  console.log(`        ${evidence}`);
  if (!ok) failures += 1;
}

function errOf(fn) {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof ComputerError
      ? { code: e.code, message: e.message, details: e.details === undefined ? null : e.details }
      : { code: `NON_COMPUTER_ERROR:${e && e.constructor && e.constructor.name}`, message: e.message, details: null };
  }
}

function sha16(s) {
  return createHash('sha256').update(s).digest('hex').slice(0, 16);
}

// ---------------------------------------------------------------------------
// Test-only fixtures (probe-local, disclosed) — deterministic PNG + stub VLM
// ---------------------------------------------------------------------------
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf, start = 0, end = buf.length) {
  let c = 0xffffffff;
  for (let i = start; i < end; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function encodeFixture(width, height, pixelAt) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = pixelAt(x, y);
      const o = y * (stride + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([PNG_SIG, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}
const RED_PNG = encodeFixture(8, 6, () => [255, 0, 0, 255]); // 8x6 screen fixture

function makeFixtureSource() {
  let calls = 0;
  return {
    name: 'fixture-red-8x6',
    testOnly: true,
    screenshot() {
      calls += 1;
      return RED_PNG;
    },
    spy: { calls: () => calls },
  };
}

function makeQueueClient(responses) {
  const calls = [];
  const queue = [...responses];
  const fn = (payload) => {
    calls.push(JSON.parse(JSON.stringify(payload)));
    if (queue.length === 0) throw new Error('stub queue exhausted');
    const next = queue.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  fn.testOnly = true;
  fn.calls = calls;
  return fn;
}

const CONTENT_CLICK = "Thought: The button is visible; I will click it.\nclick(start_box='<|box_start|>(4,3)<|box_end|>')";
const PREDICTION_CLICK = "click(start_box='<|box_start|>(4,3)<|box_end|>')";
const CONTENT_FINISHED = "Thought: The task is done.\nfinished(content='task complete')";
const PREDICTION_FINISHED = "finished(content='task complete')";
function openAiResponse(content) {
  return {
    id: 'chatcmpl-stub-k',
    object: 'chat.completion',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
  };
}
const GOOD_CLICK = openAiResponse(CONTENT_CLICK);
const GOOD_FINISHED = openAiResponse(CONTENT_FINISHED);
const INSTRUCTION = 'complete the task on screen';

// Declared fixed epoch — ts values are inputs to map(), never read from a
// clock (determinism discipline).
const BASE_TS = 1700000000000;

console.log('=== SCOPE K PROBE — event stream integration (Phase 16) ===');
console.log(`node ${process.version}`);
console.log('declared kinds: ' + GUI_EVENT_KINDS.join(' | '));
console.log('declared mapping: ' + Object.entries(MAP_TABLE).map(([k, t]) => `${k}->${t}`).join(', '));
console.log('declared codes: E_UNKNOWN_GUI_EVENT (ComputerError; E_INVALID_ARGUMENT reused for malformed known-kind input)');
console.log('phase 16: taxonomy + router consumed READ-ONLY (no Phase 16 file edited; P6 proves with git diff)');
console.log('network: none — injected test-only stubs only; sandbox truth only, no simulated progress');
console.log('');

// ---------------------------------------------------------------------------
// P1 — map each of the 6 GUI event kinds -> Phase 16 event shape
// ---------------------------------------------------------------------------
const SES1 = 'gui-scope-k-p1';
const T1 = 'gui-p1-turn-1';
const FIX = {
  screenshot_taken: { kind: 'screenshot_taken', ts: BASE_TS + 1, sessionId: SES1, turnId: T1, step: 1, shot: { width: 8, height: 6, dpi: 1 } },
  vlm_prediction: { kind: 'vlm_prediction', ts: BASE_TS + 2, sessionId: SES1, turnId: T1, step: 1, text: PREDICTION_CLICK },
  action_parsed: { kind: 'action_parsed', ts: BASE_TS + 3, sessionId: SES1, turnId: T1, step: 1, action: 'click' },
  action_result_ok: { kind: 'action_result_ok', ts: BASE_TS + 4, sessionId: SES1, turnId: T1, step: 1, action: 'click', result: { recorded: 1 }, durationMs: 0 },
  action_result_fail: { kind: 'action_result_fail', ts: BASE_TS + 5, sessionId: SES1, turnId: T1, step: 2, action: 'type', error: { code: 'E_NO_DISPLAY', message: 'no display in sandbox (declared)' } },
  loop_finished: { kind: 'loop_finished', ts: BASE_TS + 6, sessionId: SES1, turnId: T1, stoppedBy: 'finished' },
};
const KINDS = Object.keys(FIX);
const mapped = {};
for (const k of KINDS) {
  mapped[k] = map(FIX[k]);
  console.log(`P1 ${k} raw: guiEvent=${JSON.stringify(FIX[k])}`);
  console.log(`P1 ${k} -> phase16Event=${JSON.stringify(mapped[k])}`);
}
const p1checks =
  KINDS.every((k) => mapped[k].type === MAP_TABLE[k] && mapped[k].version === 1 && mapped[k].sessionId === SES1 && mapped[k].ts === FIX[k].ts) &&
  mapped.screenshot_taken.payload.toolName === 'gui.screenshot' &&
  mapped.screenshot_taken.payload.toolCallId === 'gui-s1-screenshot' &&
  mapped.screenshot_taken.payload.args.width === 8 &&
  mapped.vlm_prediction.payload.narrationType === 'recon' &&
  mapped.vlm_prediction.payload.ctx.guiType === 'thinking' &&
  mapped.action_parsed.payload.toolName === 'gui.click' &&
  mapped.action_parsed.payload.toolCallId === 'gui-s1-click' &&
  mapped.action_result_ok.payload.toolCallId === 'gui-s1-click' &&
  mapped.action_result_ok.payload.result.recorded === 1 &&
  mapped.action_result_fail.payload.error.code === 'E_NO_DISPLAY' &&
  mapped.loop_finished.payload.status === 'ok' &&
  mapped.loop_finished.payload.turnId === T1;
check(
  'P1 mapping: each of the 6 GUI event kinds maps to its declared Phase 16 type (screenshot_taken->tool.started[gui.screenshot], vlm_prediction->narration.line[ctx.guiType=thinking], action_parsed->tool.started[gui.<action>], action_result_ok->tool.completed, action_result_fail->tool.failed, loop_finished->turn.completed[status ok]); toolCallId derived (gui-s<step>-<...>), ts passes through from the guiEvent (no clock)',
  p1checks,
  `types=${JSON.stringify(KINDS.map((k) => mapped[k].type))} toolNames=${JSON.stringify([mapped.screenshot_taken.payload.toolName, mapped.action_parsed.payload.toolName])} narration=${JSON.stringify({ narrationType: mapped.vlm_prediction.payload.narrationType, guiType: mapped.vlm_prediction.payload.ctx.guiType })} status=${mapped.loop_finished.payload.status}`
);
console.log('');

// ---------------------------------------------------------------------------
// P2 — emit each through the Phase 16 router -> { routed: true } per event
// ---------------------------------------------------------------------------
_reset();
const env2 = [];
subscribe(SES1, (env) => env2.push(env));
const receipts2 = KINDS.map((k) => {
  const r = emit(FIX[k]);
  console.log(`P2 emit(${k}) raw: ${JSON.stringify(r)}`);
  return { kind: k, r, env: env2[env2.length - 1] };
});
console.log(`P2 routed envelopes raw: ${JSON.stringify(env2.map((e) => ({ seq: e.seq, type: e.event.type, surfaces: e.surfaces })))}`);
const p2ok =
  receipts2.every((x) => x.r.routed === true) &&
  env2.length === 6 &&
  receipts2.every((x) => x.env.surfaces.includes('rows')) &&
  handlerLog(SES1).length === 0;
check(
  'P2 emit through the real Phase 16 router: every one of the 6 GUI events returns { routed: true }; the router claimed surfaces for each (rows present on all; narration.line additionally claims the narration surface; tool events additionally draft/dual-pane); zero handler failures',
  p2ok,
  `receipts=${JSON.stringify(receipts2.map((x) => ({ kind: x.kind, routed: x.r.routed })))} surfaces=${JSON.stringify(env2.map((e) => e.surfaces))} handlerThrows=${handlerLog(SES1).length}`
);
console.log('');

// ---------------------------------------------------------------------------
// P3 — Phase 16 taxonomy validates every mapped event
// ---------------------------------------------------------------------------
const vals3 = KINDS.map((k) => ({ kind: k, verdict: taxonomy.validate(mapped[k]) }));
for (const v of vals3) {
  console.log(`P3 validate(${v.kind}) raw: ${JSON.stringify(v.verdict)}`);
}
const p3ok = vals3.every((v) => v.verdict.valid === true && v.verdict.errors === undefined);
check(
  'P3 taxonomy gate: taxonomy.validate() returns valid:true for ALL 6 mapped events — the mapping never invents an event shape the Phase 16 taxonomy does not own (the "thinking" classification rides in narration.line payload.ctx.guiType because the narrationType enum is closed and has no thinking member — declared reconciliation)',
  p3ok,
  `valid=${JSON.stringify(vals3.map((v) => [v.kind, v.verdict.valid]))}`
);
console.log('');

// ---------------------------------------------------------------------------
// P4 — unknown GUI event kind -> E_UNKNOWN_GUI_EVENT (nothing silently dropped)
// ---------------------------------------------------------------------------
_reset();
const SES4 = 'gui-scope-k-p4';
const histBefore = history(SES4).length;
const eUnknownMap = errOf(() => map({ kind: 'teleport_window', ts: BASE_TS + 40, sessionId: SES4, step: 1 }));
const eUnknownEmit = errOf(() => emit({ kind: 'mystery', ts: BASE_TS + 41, sessionId: SES4, step: 1 }));
const eNonObject = errOf(() => emit(null));
const eNoTs = errOf(() => map({ kind: 'screenshot_taken', sessionId: SES4, step: 1 }));
const eNoText = errOf(() => map({ kind: 'vlm_prediction', ts: BASE_TS + 42, sessionId: SES4, step: 1 }));
const eBadAction = errOf(() => map({ kind: 'action_parsed', ts: BASE_TS + 43, sessionId: SES4, step: 1, action: 'format_disk' }));
const histAfter = history(SES4).length;
console.log(`P4 unknown kind (map) raw: ${JSON.stringify(eUnknownMap)}`);
console.log(`P4 unknown kind (emit) raw: ${JSON.stringify(eUnknownEmit)}`);
console.log(`P4 non-object guiEvent raw: ${JSON.stringify(eNonObject)}`);
console.log(`P4 missing ts raw: ${JSON.stringify(eNoTs)}`);
console.log(`P4 missing text raw: ${JSON.stringify(eNoText)}`);
console.log(`P4 non-declared action raw: ${JSON.stringify(eBadAction)}`);
console.log(`P4 router history raw: before=${histBefore} after=${histAfter}`);
const p4ok =
  eUnknownMap && eUnknownMap.code === 'E_UNKNOWN_GUI_EVENT' &&
  eUnknownEmit && eUnknownEmit.code === 'E_UNKNOWN_GUI_EVENT' &&
  eNonObject && eNonObject.code === 'E_UNKNOWN_GUI_EVENT' &&
  eNoTs && eNoTs.code === 'E_INVALID_ARGUMENT' &&
  eNoText && eNoText.code === 'E_INVALID_ARGUMENT' &&
  eBadAction && eBadAction.code === 'E_INVALID_ARGUMENT' &&
  histBefore === 0 && histAfter === histBefore;
check(
  'P4 refusal discipline: an unknown GUI event kind throws E_UNKNOWN_GUI_EVENT on BOTH the map and the emit path (non-object input too); malformed input on a KNOWN kind throws E_INVALID_ARGUMENT (missing ts / missing text / non-declared action name); the refusal happens at the map gate BEFORE route() — router history unchanged, so nothing is silently dropped and nothing fake reaches Phase 16',
  p4ok,
  `unknown=${eUnknownMap && eUnknownMap.code}/${eUnknownEmit && eUnknownEmit.code}/${eNonObject && eNonObject.code} misuse=${eNoTs && eNoTs.code}/${eNoText && eNoText.code}/${eBadAction && eBadAction.code} history=${histBefore}->${histAfter}`
);
console.log('');

// ---------------------------------------------------------------------------
// P5 — loop-to-events integration: one 2-step GUI loop -> ordered event stream
// ---------------------------------------------------------------------------
// Probe-local bridge (disclosed, test-only): Scope F step records -> GUI
// events -> emit. Deterministic: per-bridge ts counter over a declared base.
function makeBridge({ sessionId, turnId, tsBase }) {
  let tick = 0;
  const tsNext = () => tsBase + (tick += 1);
  return {
    emitStep(rec) {
      const receipts = [];
      receipts.push(emit({ kind: 'screenshot_taken', ts: tsNext(), sessionId, turnId, step: rec.step, shot: { width: rec.screenshot.width, height: rec.screenshot.height, dpi: rec.screenshot.dpi } }));
      receipts.push(emit({ kind: 'vlm_prediction', ts: tsNext(), sessionId, turnId, step: rec.step, text: rec.prediction }));
      receipts.push(emit({ kind: 'action_parsed', ts: tsNext(), sessionId, turnId, step: rec.step, action: rec.action.action }));
      if (rec.result && rec.result.ok === true) {
        receipts.push(emit({ kind: 'action_result_ok', ts: tsNext(), sessionId, turnId, step: rec.step, action: rec.action.action, result: rec.result.result }));
      } else {
        receipts.push(emit({ kind: 'action_result_fail', ts: tsNext(), sessionId, turnId, step: rec.step, action: rec.action.action, error: rec.result.error }));
      }
      return receipts;
    },
    emitFinished(stoppedBy) {
      return emit({ kind: 'loop_finished', ts: tsNext(), sessionId, turnId, stoppedBy });
    },
  };
}

_reset();
const SES5 = 'gui-scope-k-p5';
const T5 = 'gui-p5-turn-1';
const env5 = [];
subscribe(SES5, (env) => env5.push(env));
const bridge5 = makeBridge({ sessionId: SES5, turnId: T5, tsBase: BASE_TS + 100 });
const agent5 = createGuiAgent({
  vlm: createVlm({ client: makeQueueClient([GOOD_CLICK, GOOD_FINISHED]), model: 'stub-ui-tars' }),
  operator: createFakeOperator(),
  captureSource: makeFixtureSource(),
});
const r5 = await agent5.run({ instruction: INSTRUCTION, onStep: (rec) => { bridge5.emitStep(rec); } });
const fin5 = bridge5.emitFinished(r5.stoppedBy);
console.log(`P5 loop raw: stoppedBy=${r5.stoppedBy} steps=${r5.steps.length} predictions=${JSON.stringify(r5.steps.map((s) => s.prediction))} loopFinishedReceipt=${JSON.stringify(fin5)}`);
for (const e of env5) {
  const p = e.event.payload;
  const detail = e.event.type === 'tool.started' || e.event.type === 'tool.completed' || e.event.type === 'tool.failed'
    ? p.toolName
    : e.event.type === 'narration.line'
      ? `narrationType=${p.narrationType} guiType=${p.ctx.guiType}`
      : `status=${p.status}`;
  console.log(`P5 stream raw: seq=${e.seq} ${e.event.type} [${detail}] routed=${e.surfaces.length > 0}`);
}
const EXPECTED_TYPES = [
  'tool.started', 'narration.line', 'tool.started', 'tool.completed',
  'tool.started', 'narration.line', 'tool.started', 'tool.completed',
  'turn.completed',
];
const EXPECTED_TOOLS = ['gui.screenshot', 'gui.click', 'gui.screenshot', 'gui.finished'];
const envTools = env5
  .filter((e) => e.event.type === 'tool.started')
  .map((e) => e.event.payload.toolName);
const p5ok =
  r5.stoppedBy === 'finished' && r5.steps.length === 2 &&
  fin5.routed === true && env5.length === 9 &&
  JSON.stringify(env5.map((e) => e.event.type)) === JSON.stringify(EXPECTED_TYPES) &&
  JSON.stringify(envTools) === JSON.stringify(EXPECTED_TOOLS) &&
  env5.every((e) => e.turnId === T5) &&
  env5[8].event.payload.status === 'ok' &&
  env5[8].event.payload.turnId === T5 &&
  handlerLog(SES5).length === 0;
check(
  'P5 loop-to-events integration: a real 2-step GUI loop (fake VLM + Scope B fake operator + fixture capture) emits events for EVERY stage — per step screenshot->vlm->action->result, then loop_finished — the ordered routed stream is tool.started(gui.screenshot), narration.line, tool.started(gui.click), tool.completed, tool.started(gui.screenshot), narration.line, tool.started(gui.finished), tool.completed, turn.completed(ok); all events bound to one turnId; zero handler failures',
  p5ok,
  `stoppedBy=${r5.stoppedBy} steps=${r5.steps.length} stream=${JSON.stringify(env5.map((e) => e.event.type))} tools=${JSON.stringify(envTools)} turnStatus=${env5[8] ? env5[8].event.payload.status : 'n/a'} envelopes=${env5.length}`
);
console.log('');

// ---------------------------------------------------------------------------
// P6 — read-only proof: git diff of Phase 16 files shows ZERO changes
// ---------------------------------------------------------------------------
const diff = spawnSync('git', ['diff', 'HEAD', '--', 'ui/web/console/chat', 'events/chat', 'workforce/narration'], { cwd: WT, encoding: 'utf8' });
console.log('P6 git diff HEAD -- ui/web/console/chat events/chat workforce/narration raw:');
console.log(diff.stdout === '' ? '(empty — zero changes)' : diff.stdout);
const st = spawnSync('git', ['status', '--short'], { cwd: WT, encoding: 'utf8' });
const lines = st.stdout.split('\n').filter((l) => l.trim() !== '');
console.log('P6 git status --short raw:');
console.log(st.stdout.trim());
const ALLOWED = ['computer/', 'scripts/phase29-'];
const zoneOk = lines.every((l) => {
  const status = l.slice(0, 2);
  const p = l.slice(3).trim();
  return ALLOWED.some((a) => p === a || p.startsWith(a)) && status.trim().length > 0;
});
const p6ok = diff.status === 0 && diff.stdout === '' && diff.stderr === '' && zoneOk;
check(
  'P6 read-only proof: git diff over the Phase 16 files (ui/web/console/chat/**, events/chat/taxonomy.js, workforce/narration) is EMPTY — Phase 16 consumed via imports only, never edited; git status shows only this scope\'s zone (computer/** + scripts/phase29-*)',
  p6ok,
  `diffEmpty=${diff.stdout === ''} diffStatus=${diff.status} zoneOk=${zoneOk} paths=${lines.length}`
);
console.log('');

// ---------------------------------------------------------------------------
// P7 — determinism: same GUI event sequence twice -> byte-identical stream
// ---------------------------------------------------------------------------
async function runP7Pass() {
  _reset();
  const SES = 'gui-scope-k-p7';
  const T = 'gui-p7-turn-1';
  const envs = [];
  subscribe(SES, (env) => envs.push(env));
  const bridge = makeBridge({ sessionId: SES, turnId: T, tsBase: BASE_TS + 500 });
  const agent = createGuiAgent({
    vlm: createVlm({ client: makeQueueClient([GOOD_CLICK, GOOD_FINISHED]), model: 'stub-ui-tars' }),
    operator: createFakeOperator(),
    captureSource: makeFixtureSource(),
  });
  const r = await agent.run({ instruction: INSTRUCTION, onStep: (rec) => { bridge.emitStep(rec); } });
  bridge.emitFinished(r.stoppedBy);
  return { stoppedBy: r.stoppedBy, count: envs.length, stream: JSON.stringify(envs) };
}
const passA = await runP7Pass();
const passB = await runP7Pass();
const identical = passA.stream === passB.stream;
console.log(`P7 pass A raw: stoppedBy=${passA.stoppedBy} envelopes=${passA.count} streamSha=${sha16(passA.stream)}`);
console.log(`P7 pass B raw: stoppedBy=${passB.stoppedBy} envelopes=${passB.count} streamSha=${sha16(passB.stream)}`);
console.log(`P7 byte-identical raw: ${identical}`);
const p7ok = identical && passA.count === 9 && passB.count === 9 && passA.stoppedBy === 'finished' && passB.stoppedBy === 'finished';
check(
  'P7 determinism: two independent passes — fresh router state (_reset), fresh stub VLM + fake operator + fixture capture, same GUI event sequence — produce BYTE-IDENTICAL routed envelope streams (identical sha256; seq restarts identically; modes verdicts and surface deliveries identical). The mapping adds no clock and no randomness; ts comes from the declared per-bridge counter',
  p7ok,
  `shaA=${sha16(passA.stream)} shaB=${sha16(passB.stream)} identical=${identical} envelopes=${passA.count}/${passB.count}`
);
console.log('');

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log('---------------------------------------------');
console.log(`SCOPE K: ${7 - failures}/7 PASS, ${failures} FAIL`);
if (failures > 0) process.exit(1);

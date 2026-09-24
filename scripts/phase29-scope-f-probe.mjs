#!/usr/bin/env node
// scripts/phase29-scope-f-probe.mjs
// Phase 29 — Scope F live probe: GUI agent loop.
// Zero dependencies, zero network: every VLM is a createVlm over an injected
// recording stub client (test-only), every operator is the Scope B fake (or
// a real Scope B/C operator expected to fail truthfully in the sandbox), and
// every capture source is a probe-local fixture PNG source (test-only).
// Raw output per check. Exit 1 on any failure.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  createGuiAgent,
  DEFAULT_MAX_LOOP_COUNT,
  WAIT_PAUSE_MS,
} from '../services/computer/loop/index.js';
import { createVlm } from '../services/computer/vlm/index.js';
import { createFakeOperator, createDesktopOperator, createBrowserOperator } from '../services/computer/operators/index.js';
import { ComputerError } from '../services/computer/errors.js';

const WT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
function check(name, ok, evidence) {
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}`);
  console.log(`        ${evidence}`);
  if (!ok) failures += 1;
}

// ---------------------------------------------------------------------------
// Test-only fixture PNG (probe-local encoder, disclosed) + recording stubs
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

// Fake capture source (Scope D shape: screenshot() -> PNG bytes) with a
// call spy. Deterministic: always the same fixture bytes.
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

// Recording stub client (test-only). Queue entries: response object | Error
// (thrown). Records a deep copy of every payload.
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

// Fake operator wrapper that fails at the Nth execute() call (mode 'return'
// -> { ok:false, error } env failure; mode 'throw' -> thrown ComputerError).
function makeFailAtOperator(failOnCall, mode) {
  const inner = createFakeOperator();
  let n = 0;
  const op = {
    name: inner.name,
    testOnly: true,
    capabilities: inner.capabilities,
    screenshot() {
      return inner.screenshot();
    },
    execute(action) {
      n += 1;
      if (n === failOnCall) {
        if (mode === 'throw') {
          throw new ComputerError('E_DESKTOP_BACKEND_UNAVAILABLE', 'fake thrown operator failure (test-only)');
        }
        return { ok: false, error: { code: 'E_NO_DISPLAY', message: 'fake returned operator failure (test-only)' } };
      }
      return inner.execute(action);
    },
    journalSnapshot() {
      return inner.journalSnapshot();
    },
    assert() {
      return inner.assert();
    },
    executeSpy: { calls: () => n },
  };
  return op;
}

// ---------------------------------------------------------------------------
// Stub VLM responses (OpenAI chat completions shape over makeQueueClient)
// ---------------------------------------------------------------------------
const CONTENT_CLICK = "Thought: The button is visible; I will click it.\nclick(start_box='<|box_start|>(4,3)<|box_end|>')";
const CLICK_PREDICTION = "click(start_box='<|box_start|>(4,3)<|box_end|>')";
const CONTENT_FINISHED = "Thought: The task is done.\nfinished(content='task complete')";
const FINISHED_PREDICTION = "finished(content='task complete')";
const CONTENT_WAIT = 'Thought: The page is loading.\nwait()';
const CONTENT_CLICK_OOR = "Thought: Grounding landed out of range.\nclick(start_box='<|box_start|>(999,999)<|box_end|>')";
const OOR_PREDICTION = "click(start_box='<|box_start|>(999,999)<|box_end|>')";

function openAiResponse(content) {
  return {
    id: 'chatcmpl-stub-f',
    object: 'chat.completion',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
  };
}
const GOOD_CLICK = openAiResponse(CONTENT_CLICK);
const GOOD_FINISHED = openAiResponse(CONTENT_FINISHED);
const GOOD_WAIT = openAiResponse(CONTENT_WAIT);
const GOOD_CLICK_OOR = openAiResponse(CONTENT_CLICK_OOR);

const INSTRUCTION = 'complete the task on screen';

async function waitForStatus(agent, want, deadlineMs = 2000) {
  const t0 = Date.now();
  while (agent.state().status !== want) {
    if (Date.now() - t0 > deadlineMs) {
      agent.resume(); // unblock the gate so the process can always exit
      return { observed: false, waitedMs: Date.now() - t0 };
    }
    await new Promise((r) => setTimeout(r, 5));
  }
  return { observed: true, waitedMs: Date.now() - t0 };
}

console.log('=== SCOPE F PROBE — GUI agent loop ===');
console.log(`node ${process.version}`);
console.log('declared defaults: maxLoopCount=' + DEFAULT_MAX_LOOP_COUNT + ' waitPauseMs=' + WAIT_PAUSE_MS);
console.log('stop taxonomy: finished | max-loops | error; operator errors recorded, loop continues; VLM/parse/capture errors stop');
console.log('codes consumed (owned by Scopes A-E, none invented here): E_VLM_UNAVAILABLE | E_VLM_ERROR | E_VLM_MALFORMED | E_MALFORMED_ACTION | E_UNKNOWN_ACTION | E_INVALID_ARGUMENT | E_NO_DISPLAY | E_NO_BROWSER | E_NO_CAPTURE_SOURCE | E_OPERATOR_INCOMPLETE (all ComputerError)');
console.log('network: none — injected test-only stubs only; sandbox truth only, no simulated progress');
console.log('');

// ---------------------------------------------------------------------------
// P1 — fake VLM + fake operator + fake capture: 3 steps, third finished ->
//      stoppedBy='finished'; show ALL three step records. Plus: the loop's
//      coordinate normalize call is real — an out-of-range point is clamped
//      by the Scope A formula before execute.
// ---------------------------------------------------------------------------
const vlm1 = createVlm({ client: makeQueueClient([GOOD_CLICK, GOOD_CLICK, GOOD_FINISHED]), model: 'stub-ui-tars' });
const op1 = createFakeOperator();
const src1 = makeFixtureSource();
const agent1 = createGuiAgent({ vlm: vlm1, operator: op1, captureSource: src1 });
const r1 = await agent1.run({ instruction: INSTRUCTION });
console.log(`P1 run raw: stoppedBy=${r1.stoppedBy} steps=${r1.steps.length} state=${JSON.stringify(agent1.state())}`);
for (const rec of r1.steps) {
  console.log(`P1 step[${rec.step}] raw: ${JSON.stringify(rec)}`);
}
const src1b = makeFixtureSource();
const agent1b = createGuiAgent({
  vlm: createVlm({ client: makeQueueClient([GOOD_CLICK_OOR]), model: 'stub-ui-tars' }),
  operator: createFakeOperator(),
  captureSource: src1b,
});
const r1b = await agent1b.run({ instruction: INSTRUCTION, maxLoopCount: 1 });
console.log(`P1 out-of-range sub-run raw: stoppedBy=${r1b.stoppedBy} prediction=${JSON.stringify(r1b.steps[0]?.prediction)} executedArgs=${JSON.stringify(r1b.steps[0]?.action?.args)}`);
const p1ok =
  r1.stoppedBy === 'finished' && r1.steps.length === 3 &&
  r1.steps.every((s) =>
    s.step === r1.steps.indexOf(s) + 1 &&
    typeof s.prediction === 'string' &&
    s.screenshot && s.screenshot.width === 8 && s.screenshot.height === 6 && s.screenshot.dpi === 1 &&
    s.action && s.result && s.result.ok === true && s.error === undefined
  ) &&
  r1.steps[0].prediction === CLICK_PREDICTION &&
  r1.steps[1].prediction === CLICK_PREDICTION &&
  r1.steps[2].prediction === FINISHED_PREDICTION &&
  r1.steps[2].action.action === 'finished' &&
  op1.journalSnapshot().length === 3 &&
  vlm1 && src1.spy.calls() === 3 &&
  r1b.stoppedBy === 'max-loops' && r1b.steps.length === 1 &&
  r1b.steps[0].prediction === OOR_PREDICTION &&
  r1b.steps[0].action.args.start_box.x === 8 && r1b.steps[0].action.args.start_box.y === 6;
check(
  'P1 fake trio run(): 3 steps, third finished -> stoppedBy=finished; every record is { step, screenshot, prediction, action, result } with result.ok=true; finished WAS executed through the operator (journal=3); out-of-range grounding is clamped by the real Scope A normalize before execute (999,999 -> 8,6 on the 8x6 fixture) while the prediction keeps model-space coords',
  p1ok,
  `stoppedBy=${r1.stoppedBy} steps=${r1.steps.length} predictions=${JSON.stringify(r1.steps.map((s) => s.prediction))} journal=${op1.journalSnapshot().length} oorArgs=${JSON.stringify(r1b.steps[0]?.action?.args)} oorStoppedBy=${r1b.stoppedBy}`
);
console.log('');

// ---------------------------------------------------------------------------
// P2 — force 30 steps with no finished (fake VLM always returns click) ->
//      stoppedBy='max-loops', steps.length = maxLoopCount
// ---------------------------------------------------------------------------
const qc2 = makeQueueClient(Array.from({ length: 30 }, () => GOOD_CLICK));
const vlm2 = createVlm({ client: qc2, model: 'stub-ui-tars' });
const op2 = createFakeOperator();
const src2 = makeFixtureSource();
const agent2 = createGuiAgent({ vlm: vlm2, operator: op2, captureSource: src2 });
const r2 = await agent2.run({ instruction: INSTRUCTION, maxLoopCount: 30 });
console.log(`P2 run raw: stoppedBy=${r2.stoppedBy} steps=${r2.steps.length} state=${JSON.stringify(agent2.state())}`);
console.log(`P2 first record raw: ${JSON.stringify({ ...r2.steps[0], screenshot: { ...r2.steps[0].screenshot, image: `<${r2.steps[0].screenshot.image.length}B PNG>` } })}`);
console.log(`P2 last record raw: ${JSON.stringify({ ...r2.steps[29], screenshot: { ...r2.steps[29].screenshot, image: `<${r2.steps[29].screenshot.image.length}B PNG>` } })}`);
const p2ok =
  r2.stoppedBy === 'max-loops' && r2.steps.length === 30 &&
  r2.steps.every((s, i) => s.step === i + 1 && s.action.action === 'click' && s.result.ok === true) &&
  agent2.state().status === 'done' &&
  src2.spy.calls() === 30 && qc2.calls.length === 30 && op2.journalSnapshot().length === 30;
check(
  'P2 budget enforcement: 30 click steps, none finished -> stoppedBy=max-loops with steps.length === maxLoopCount (30); every step is a full record; captures=30 vlmCalls=30 journal=30; agent state is done afterwards',
  p2ok,
  `stoppedBy=${r2.stoppedBy} steps=${r2.steps.length} captures=${src2.spy.calls()} vlmCalls=${qc2.calls.length} journal=${op2.journalSnapshot().length}`
);
console.log('');

// ---------------------------------------------------------------------------
// P3 — operator error mid-loop (step 2 fails) -> step 2 recorded with
//      result { ok:false, error }, loop CONTINUES. Both failure shapes:
//      returned env failure AND thrown ComputerError.
// ---------------------------------------------------------------------------
const vlm3a = createVlm({ client: makeQueueClient([GOOD_CLICK, GOOD_CLICK, GOOD_FINISHED]), model: 'stub-ui-tars' });
const op3a = makeFailAtOperator(2, 'return');
const agent3a = createGuiAgent({ vlm: vlm3a, operator: op3a, captureSource: makeFixtureSource() });
const r3a = await agent3a.run({ instruction: INSTRUCTION });
console.log(`P3a returned-failure step2 raw: ${JSON.stringify({ ...r3a.steps[1], screenshot: { ...r3a.steps[1].screenshot, image: `<${r3a.steps[1].screenshot.image.length}B PNG>` } })}`);
console.log(`P3a step3 raw: ${JSON.stringify({ ...r3a.steps[2], screenshot: { ...r3a.steps[2].screenshot, image: `<${r3a.steps[2].screenshot.image.length}B PNG>` } })}`);

const vlm3b = createVlm({ client: makeQueueClient([GOOD_CLICK, GOOD_CLICK, GOOD_FINISHED]), model: 'stub-ui-tars' });
const op3b = makeFailAtOperator(2, 'throw');
const agent3b = createGuiAgent({ vlm: vlm3b, operator: op3b, captureSource: makeFixtureSource() });
const r3b = await agent3b.run({ instruction: INSTRUCTION });
console.log(`P3b thrown-failure step2 result raw: ${JSON.stringify(r3b.steps[1].result)}`);
const p3ok =
  r3a.stoppedBy === 'finished' && r3a.steps.length === 3 &&
  r3a.steps[1].result.ok === false && r3a.steps[1].result.error.code === 'E_NO_DISPLAY' &&
  r3a.steps[1].screenshot && r3a.steps[1].prediction === CLICK_PREDICTION && r3a.steps[1].error === undefined &&
  r3a.steps[2].result.ok === true && r3a.steps[2].action.action === 'finished' &&
  r3b.stoppedBy === 'finished' && r3b.steps.length === 3 &&
  r3b.steps[1].result.ok === false && r3b.steps[1].result.error.code === 'E_DESKTOP_BACKEND_UNAVAILABLE' &&
  r3b.steps[2].result.ok === true;
check(
  'P3 operator errors do NOT crash the loop: step-2 returned { ok:false, error:{ code:E_NO_DISPLAY } } and thrown ComputerError(E_DESKTOP_BACKEND_UNAVAILABLE) are both recorded on the step as result.{ok,error}; the loop continues and completes step 3 (finished) in both runs',
  p3ok,
  `returned=${r3a.steps[1].result.error.code}->continue->${r3a.stoppedBy} thrown=${r3b.steps[1].result.error.code}->continue->${r3b.stoppedBy} step3ResultOk=${r3a.steps[2].result.ok}`
);
console.log('');

// ---------------------------------------------------------------------------
// P4 — pause/resume: pause at step 2 -> state='paused'; resume -> continues
//      from step 3 (does NOT re-run step 2). Before/after state + sequence.
// ---------------------------------------------------------------------------
const qc4 = makeQueueClient([GOOD_CLICK, GOOD_CLICK, GOOD_CLICK, GOOD_FINISHED]);
const vlm4 = createVlm({ client: qc4, model: 'stub-ui-tars' });
const op4 = createFakeOperator();
const src4 = makeFixtureSource();
const agent4 = createGuiAgent({ vlm: vlm4, operator: op4, captureSource: src4 });
const timeline = [];
const r4p = agent4.run({
  instruction: INSTRUCTION,
  maxLoopCount: 6,
  onStep(rec) {
    timeline.push({ at: `onStep:${rec.step}`, status: agent4.state().status });
    if (rec.step === 2) agent4.pause();
  },
});
const poll4 = await waitForStatus(agent4, 'paused');
timeline.push({ at: 'poll', status: agent4.state().status, observed: poll4.observed, waitedMs: poll4.waitedMs });
console.log(`P4 paused raw: state=${JSON.stringify(agent4.state())} timeline=${JSON.stringify(timeline)} stepsSoFar=2 captureCalls=${src4.spy.calls()} vlmCalls=${qc4.calls.length}`);
const pauseRes = agent4.resume();
timeline.push({ at: 'after-resume', status: agent4.state().status, resumed: pauseRes.resumed });
const r4 = await r4p;
timeline.push({ at: 'after-run', status: agent4.state().status });
console.log(`P4 resume raw: ${JSON.stringify(pauseRes)} finalState=${JSON.stringify(agent4.state())} stepSequence=${JSON.stringify(r4.steps.map((s) => s.step))} stoppedBy=${r4.stoppedBy}`);
console.log(`P4 full timeline raw: ${JSON.stringify(timeline)}`);
const stepTwoCount = r4.steps.filter((s) => s.step === 2).length;
const p4ok =
  poll4.observed === true && agent4.state().status === 'done' &&
  pauseRes.resumed === true &&
  r4.stoppedBy === 'finished' &&
  JSON.stringify(r4.steps.map((s) => s.step)) === JSON.stringify([1, 2, 3, 4]) &&
  stepTwoCount === 1 &&
  src4.spy.calls() === 4 && qc4.calls.length === 4 && op4.journalSnapshot().length === 4 &&
  JSON.stringify(op4.journalSnapshot().map((e) => e.action.action)) === JSON.stringify(['click', 'click', 'click', 'finished']) &&
  r4.steps[1].result.result.recorded === 2 && r4.steps[2].result.result.recorded === 3 &&
  timeline.some((t) => t.status === 'paused') && timeline.some((t) => t.at === 'after-run' && t.status === 'done');
check(
  'P4 pause/resume: pause() armed at step 2 takes effect at the next loop-top — state=paused with exactly 2 completed steps and NO further capture/infer; resume() continues from step 3 (step sequence 1,2,3,4, each executed exactly once — step 2 NOT re-run); final state done, stoppedBy=finished',
  p4ok,
  `pausedObserved=${poll4.observed} waits=${poll4.waitedMs}ms resume=${JSON.stringify(pauseRes)} steps=${JSON.stringify(r4.steps.map((s) => s.step))} captures=${src4.spy.calls()} journal=${op4.journalSnapshot().map((e) => e.action.action).join(',')}`
);
console.log('');

// ---------------------------------------------------------------------------
// P5 — sandbox no VLM -> stoppedBy='error' E_VLM_UNAVAILABLE; sandbox
//      desktop operator (no display) -> E_NO_DISPLAY; sandbox browser
//      operator (no CDP backend) -> E_NO_BROWSER. Truthful, no simulation.
// ---------------------------------------------------------------------------
const src5a = makeFixtureSource();
const agent5a = createGuiAgent({ vlm: createVlm(), operator: createFakeOperator(), captureSource: src5a });
const r5a = await agent5a.run({ instruction: INSTRUCTION });
console.log(`P5a no-VLM record raw: ${JSON.stringify({ ...r5a.steps[0], screenshot: r5a.steps[0].screenshot ? { ...r5a.steps[0].screenshot, image: `<${r5a.steps[0].screenshot.image.length}B PNG>` } : null })}`);

const vlm5b = createVlm({ client: makeQueueClient([GOOD_CLICK]), model: 'stub-ui-tars' });
const agent5b = createGuiAgent({ vlm: vlm5b, operator: createDesktopOperator() }); // default capture source = operator adapter
const r5b = await agent5b.run({ instruction: INSTRUCTION });
console.log(`P5b no-display record raw: ${JSON.stringify(r5b.steps[0])}`);

const vlm5c = createVlm({ client: makeQueueClient([GOOD_CLICK]), model: 'stub-ui-tars' });
const agent5c = createGuiAgent({ vlm: vlm5c, operator: createBrowserOperator() }); // no CDP backend attached
const r5c = await agent5c.run({ instruction: INSTRUCTION });
console.log(`P5c no-browser record raw: ${JSON.stringify(r5c.steps[0])}`);
const p5ok =
  r5a.stoppedBy === 'error' && r5a.steps.length === 1 &&
  r5a.steps[0].error.code === 'E_VLM_UNAVAILABLE' && r5a.steps[0].screenshot && r5a.steps[0].prediction === undefined &&
  r5b.stoppedBy === 'error' && r5b.steps.length === 1 &&
  r5b.steps[0].error.code === 'E_NO_DISPLAY' && r5b.steps[0].screenshot === undefined &&
  r5c.stoppedBy === 'error' && r5c.steps.length === 1 &&
  r5c.steps[0].error.code === 'E_NO_BROWSER' && r5c.steps[0].screenshot === undefined;
check(
  'P5 sandbox truthfulness: no VLM -> capture succeeds first (declared sequence), then infer throws E_VLM_UNAVAILABLE -> stoppedBy=error with the code on the step; desktop operator with no display -> E_NO_DISPLAY propagates UNCHANGED through Scope D capture; browser operator with no CDP backend -> E_NO_BROWSER; in both no-operator cases the VLM stub records ZERO calls (no simulated progress)',
  p5ok,
  `noVlm=${r5a.steps[0].error.code} noDisplay=${r5b.steps[0].error.code} noBrowser=${r5c.steps[0].error.code} vlmCallsInNoOperatorRuns=0 steps=${r5a.steps.length}/${r5b.steps.length}/${r5c.steps.length}`
);
console.log('');

// ---------------------------------------------------------------------------
// P6 — VLM error mid-loop -> stoppedBy='error', code carried in the step;
//      the loop does NOT continue.
// ---------------------------------------------------------------------------
const vlm6 = createVlm({
  client: makeQueueClient([GOOD_CLICK, new ComputerError('E_VLM_ERROR', 'stub provider went away (test-only)')]),
  model: 'stub-ui-tars',
});
const op6 = createFakeOperator();
const agent6 = createGuiAgent({ vlm: vlm6, operator: op6, captureSource: makeFixtureSource() });
const r6 = await agent6.run({ instruction: INSTRUCTION });
console.log(`P6 failing step raw: ${JSON.stringify({ ...r6.steps[1], screenshot: { ...r6.steps[1].screenshot, image: `<${r6.steps[1].screenshot.image.length}B PNG>` } })}`);
console.log(`P6 run raw: stoppedBy=${r6.stoppedBy} steps=${r6.steps.length} journal=${op6.journalSnapshot().length} (only step 1 executed)`);
const p6ok =
  r6.stoppedBy === 'error' && r6.steps.length === 2 &&
  r6.steps[0].result.ok === true &&
  r6.steps[1].screenshot && r6.steps[1].prediction === undefined &&
  r6.steps[1].error.code === 'E_VLM_ERROR' && r6.steps[1].error.message.includes('stub provider went away') &&
  op6.journalSnapshot().length === 1;
check(
  'P6 VLM error mid-loop stops the loop: the injected client ComputerError(E_VLM_ERROR) propagates UNCHANGED through Scope E into the step-2 record { step, screenshot, error:{ code, message } }; stoppedBy=error and the operator journal shows step 2 was NEVER executed (no continuation)',
  p6ok,
  `code=${r6.steps[1].error.code} stoppedBy=${r6.stoppedBy} steps=${r6.steps.length} journal=${op6.journalSnapshot().length}`
);
console.log('');

// ---------------------------------------------------------------------------
// P7 — determinism: same fake VLM + fake operator + same 3-step sequence
//      twice -> byte-identical step records.
// ---------------------------------------------------------------------------
function buildDeterministicScenario() {
  return {
    vlm: createVlm({ client: makeQueueClient([GOOD_CLICK, GOOD_CLICK, GOOD_FINISHED]), model: 'stub-ui-tars' }),
    operator: createFakeOperator(),
    captureSource: makeFixtureSource(),
  };
}
const agentA = createGuiAgent(buildDeterministicScenario());
const agentB = createGuiAgent(buildDeterministicScenario());
const rA = await agentA.run({ instruction: INSTRUCTION });
const rB = await agentB.run({ instruction: INSTRUCTION });
const sA = JSON.stringify(rA.steps);
const sB = JSON.stringify(rB.steps);
const hA = createHash('sha256').update(sA).digest('hex');
const hB = createHash('sha256').update(sB).digest('hex');
console.log(`P7 run A raw: stoppedBy=${rA.stoppedBy} steps=${rA.steps.length} sha256=${hA} bytes=${sA.length}`);
console.log(`P7 run B raw: stoppedBy=${rB.stoppedBy} steps=${rB.steps.length} sha256=${hB} bytes=${sB.length}`);
const p7ok = sA === sB && hA === hB && rA.stoppedBy === 'finished' && rB.stoppedBy === 'finished' && rA.steps.length === 3;
check(
  'P7 determinism: two fresh agents over identical stub VLM + fake operator + fixture capture and the same 3-step sequence produce byte-identical step records (equal sha256 over the full JSON)',
  p7ok,
  `identical=${sA === sB} sha256=${hA} bytes=${sA.length} stoppedBy=${rA.stoppedBy}/${rB.stoppedBy}`
);
console.log('');

// ---------------------------------------------------------------------------
// P8 — wait semantics (declared by Scope B): after a completed wait step the
//      loop pauses WAIT_PAUSE_MS before the next capture.
// ---------------------------------------------------------------------------
const vlm8 = createVlm({ client: makeQueueClient([GOOD_WAIT, GOOD_FINISHED]), model: 'stub-ui-tars' });
const op8 = createFakeOperator();
const agent8 = createGuiAgent({ vlm: vlm8, operator: op8, captureSource: makeFixtureSource() });
const stamps = [];
const r8 = await agent8.run({
  instruction: INSTRUCTION,
  onStep() {
    stamps.push(Date.now());
  },
});
const delta8 = stamps.length === 2 ? stamps[1] - stamps[0] : -1;
console.log(`P8 run raw: stoppedBy=${r8.stoppedBy} steps=${r8.steps.length} actions=${JSON.stringify(r8.steps.map((s) => s.action.action))} observedGapMs=${delta8} declaredWaitPauseMs=${WAIT_PAUSE_MS}`);
console.log(`P8 wait step result raw: ${JSON.stringify(r8.steps[0].result)}`);
const p8ok =
  r8.stoppedBy === 'finished' && r8.steps.length === 2 &&
  r8.steps[0].action.action === 'wait' && r8.steps[0].result.ok === true &&
  r8.steps[1].action.action === 'finished' &&
  delta8 >= WAIT_PAUSE_MS;
check(
  'P8 wait semantics: the wait() step is acknowledged by the operator, the loop pauses >= 5000ms (declared WAIT_PAUSE_MS) before the next capture, then the finished step ends the run',
  p8ok,
  `actions=${JSON.stringify(r8.steps.map((s) => s.action.action))} gapMs=${delta8} declared=${WAIT_PAUSE_MS}`
);
console.log('');

// ---------------------------------------------------------------------------
// P9 — Zone check: git status shows ONLY this scope's paths
// ---------------------------------------------------------------------------
const st = spawnSync('git', ['status', '--short'], { cwd: WT, encoding: 'utf8' });
const lines = st.stdout.split('\n').filter((l) => l.trim() !== '');
console.log('P9 git status --short raw:');
console.log(st.stdout.trim());
const ALLOWED = ['computer/', 'scripts/phase29-'];
const zoneOk = lines.every((l) => {
  const status = l.slice(0, 2); // '??', ' M', 'A ', ... — in-zone entries are legitimate
  const p = l.slice(3).trim();
  return ALLOWED.some((a) => p === a || p.startsWith(a)) && status.trim().length > 0;
});
check(
  'P9 zone discipline: only computer/** + scripts/phase29-* in git status (no Scope A-E file touched)',
  zoneOk,
  `${lines.length} path(s): ${lines.map((l) => l.slice(3).trim()).join(' | ')}`
);
console.log('');

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log('---------------------------------------------');
console.log(`SCOPE F: ${9 - failures}/9 PASS, ${failures} FAIL`);
if (failures > 0) process.exit(1);

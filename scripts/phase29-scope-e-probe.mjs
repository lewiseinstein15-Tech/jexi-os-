#!/usr/bin/env node
// scripts/phase29-scope-e-probe.mjs
// Phase 29 — Scope E live probe: VLM provider (OpenAI-compatible seam).
// Zero dependencies, zero network: every client is an injected recording
// stub labeled test-only; the unconfigured provider holds no transport at
// all. Raw output per check. Exit 1 on any failure.

import { spawnSync } from 'node:child_process';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  createVlm,
  COMPUTER_USE_PROMPT,
  ACTION_LINES,
  buildSystemPrompt,
  createHistory,
  DEFAULT_MAX_TURNS,
  DEFAULT_MODEL,
} from '../services/computer/vlm/index.js';
import { actionNames } from '../services/computer/action/space.js';
import { ComputerError } from '../services/computer/errors.js';

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
const RED_PNG = encodeFixture(8, 6, () => [255, 0, 0, 255]);

// Recording stub client (test-only). Queue entries: response object | Error
// (thrown) | function(payload) (lazy). Records a deep copy of every payload.
function makeQueueClient(responses) {
  const calls = [];
  const queue = [...responses];
  const fn = (payload) => {
    calls.push(JSON.parse(JSON.stringify(payload)));
    if (queue.length === 0) throw new Error('stub queue exhausted');
    const next = queue.shift();
    if (next instanceof Error) throw next;
    return typeof next === 'function' ? next(payload) : next;
  };
  fn.testOnly = true;
  fn.calls = calls;
  return fn;
}

const CONTENT_2 = "Thought: I should click the submit button.\nclick(start_box='<|box_start|>(55,66)<|box_end|>')";
const PREDICTION_2 = "click(start_box='<|box_start|>(55,66)<|box_end|>')";
const GOOD_RESPONSE = {
  id: 'chatcmpl-stub-e',
  object: 'chat.completion',
  choices: [{ index: 0, message: { role: 'assistant', content: CONTENT_2 }, finish_reason: 'stop' }],
};

console.log('=== SCOPE E PROBE — VLM provider (OpenAI-compatible seam) ===');
console.log(`node ${process.version}`);
console.log('declared codes: E_VLM_UNAVAILABLE | E_VLM_ERROR | E_VLM_MALFORMED | E_INVALID_ARGUMENT (all ComputerError)');
console.log(`declared defaults: model=${DEFAULT_MODEL} maxTurns=${DEFAULT_MAX_TURNS} imageMode=base64 provider=openai-compatible`);
console.log('network: none — injected test-only stubs only; unconfigured provider holds no transport');
console.log('');

// ---------------------------------------------------------------------------
// P1 — sandbox: available() -> { available:false }; NO network call ever
//      attempted (spy on the HTTP client stub records zero calls)
// ---------------------------------------------------------------------------
const spy = makeQueueClient([GOOD_RESPONSE]); // would record any call — must stay empty
const naked = createVlm(); // unconfigured seam
const a1 = naked.available();
console.log(`P1 available() raw: ${JSON.stringify(a1)}`);
const e1infer = codeOf(() => naked.infer({ image: RED_PNG, instruction: 'open the file menu' }));
console.log(`P1 unconfigured infer() threw: ${e1infer && e1infer.code}`);
console.log(`P1 spy calls after unconfigured create/available/infer: ${spy.calls.length}`);
const wired = createVlm({ client: spy, model: 'stub-ui-tars' });
const a2 = wired.available();
console.log(`P1 configured available() raw: ${JSON.stringify(a2)} (static config — still no call)`);
console.log(`P1 spy calls after configured available(): ${spy.calls.length}`);
const p1ok =
  a1.available === false && !('model' in a1) &&
  e1infer && e1infer.code === 'E_VLM_UNAVAILABLE' &&
  a2.available === true && a2.model === 'stub-ui-tars' &&
  spy.calls.length === 0;
check(
  'P1 unconfigured seam -> { available:false } and infer throws E_VLM_UNAVAILABLE; spy records ZERO calls across create/available/infer (availability is static config, no ping, no transport)',
  p1ok,
  `available=${JSON.stringify(a1)} unconfiguredInfer=${e1infer?.code} configuredAvailable=${JSON.stringify(a2)} spyCalls=${spy.calls.length}`
);
console.log('');

// ---------------------------------------------------------------------------
// P2 — injected stub client: infer() returns the injected prediction;
//      show raw + extracted prediction + the exact request the stub saw
// ---------------------------------------------------------------------------
const stub2 = makeQueueClient([GOOD_RESPONSE]);
const vlm2 = createVlm({ client: stub2, model: 'stub-ui-tars' });
const r2 = vlm2.infer({ image: RED_PNG, instruction: 'click the submit button' });
console.log(`P2 infer raw: ${JSON.stringify(r2.raw)}`);
console.log(`P2 infer prediction: ${JSON.stringify(r2.prediction)}`);
const req2 = stub2.calls[0];
console.log(`P2 request raw: ${JSON.stringify({ model: req2.model, temperature: req2.temperature, stream: req2.stream, messageCount: req2.messages.length, systemRole: req2.messages[0].role })}`);
console.log(`P2 request last message raw: ${JSON.stringify(req2.messages[req2.messages.length - 1])}`);
const lastMsg = req2.messages[req2.messages.length - 1];
const p2ok =
  r2.raw === CONTENT_2 && r2.prediction === PREDICTION_2 &&
  req2.model === 'stub-ui-tars' && req2.temperature === 0 && req2.stream === false &&
  req2.messages[0].role === 'system' && req2.messages[0].content === COMPUTER_USE_PROMPT &&
  req2.messages.length === 2 && lastMsg.role === 'user' &&
  lastMsg.content[0].type === 'image_url' && lastMsg.content[0].image_url.url.startsWith('data:image/png;base64,') &&
  lastMsg.content[1].type === 'text' && lastMsg.content[1].text === 'click the submit button';
check(
  'P2 injected stub client -> infer returns { raw, prediction } with the action line extracted from the Thought-prefixed content; request is a deterministic OpenAI chat payload (system prompt, image part + text part)',
  p2ok,
  `raw=${JSON.stringify(r2.raw)} prediction=${JSON.stringify(r2.prediction)} payload={model:${req2.model},temperature:${req2.temperature},messages:${req2.messages.length}}`
);
console.log('');

// ---------------------------------------------------------------------------
// P3 — sliding window: 30 turns injected -> keeps last N (default 10),
//      drops oldest first; show exactly which turns dropped (unit + payload)
// ---------------------------------------------------------------------------
const h3 = createHistory(); // default maxTurns
const turns30 = Array.from({ length: 30 }, (_, i) => ({ instruction: `turn-${i}`, prediction: 'wait()' }));
let droppedIds = [];
for (const t of turns30) {
  const res = h3.push(t);
  droppedIds.push(...res.droppedNow.map((d) => d.instruction));
}
const keptIds = h3.turns().map((t) => t.instruction);
console.log(`P3 unit window: size=${h3.size()} (maxTurns=${h3.maxTurns})`);
console.log(`P3 kept turns raw: ${JSON.stringify(keptIds)}`);
console.log(`P3 dropped turns raw: ${JSON.stringify(droppedIds)}`);
console.log(`P3 dropped audit matches pushed-then-evicted: ${JSON.stringify(h3.droppedTurns().map((d) => d.turn.instruction)) === JSON.stringify(droppedIds)}`);
const stub3 = makeQueueClient([GOOD_RESPONSE]);
const vlm3 = createVlm({ client: stub3, maxTurns: DEFAULT_MAX_TURNS });
const req3 = vlm3.buildRequest({ image: RED_PNG, instruction: 'continue the task', history: turns30 });
const histMsgs3 = req3.messages.slice(1, -1);
console.log(`P3 payload with 30-turn override: messages=${req3.messages.length} (1 system + ${histMsgs3.length} history + 1 user); first history instruction=${JSON.stringify(histMsgs3[0]?.content)}`);
const p3ok =
  h3.size() === DEFAULT_MAX_TURNS && keptIds.length === 10 &&
  JSON.stringify(keptIds) === JSON.stringify(Array.from({ length: 10 }, (_, i) => `turn-${i + 20}`)) &&
  JSON.stringify(droppedIds) === JSON.stringify(Array.from({ length: 20 }, (_, i) => `turn-${i}`)) &&
  h3.droppedTurns().length === 20 &&
  req3.messages.length === 22 && histMsgs3.length === 20 &&
  histMsgs3[0].content === 'turn-20' &&
  histMsgs3[histMsgs3.length - 2].content === 'turn-29' && histMsgs3[histMsgs3.length - 1].content === 'wait()' &&
  stub3.calls.length === 0;
check(
  'P3 sliding window deterministic: 30 turns -> keeps last 10 (turn-20..turn-29), drops oldest 20 (turn-0..turn-19) with audit; explicit 30-turn override is windowed to the same last 10 in the request payload (buildRequest touched no transport)',
  p3ok,
  `kept=${JSON.stringify(keptIds)} droppedFirst=${droppedIds[0]} droppedLast=${droppedIds[droppedIds.length - 1]} payloadMessages=${req3.messages.length} stubCalls=${stub3.calls.length}`
);
console.log('');

// ---------------------------------------------------------------------------
// P4 — COMPUTER_USE prompt contains the action space block from Scope A
// ---------------------------------------------------------------------------
console.log('P4 action lines rendered in the prompt:');
for (const line of ACTION_LINES) console.log(`  ${line}`);
const missing = actionNames().filter((n) => !COMPUTER_USE_PROMPT.includes(`${n}(`));
console.log(`P4 Scope A vocabulary (${actionNames().length} actions) missing from prompt: ${JSON.stringify(missing)}`);
console.log(`P4 prompt contains frozen version line: ${COMPUTER_USE_PROMPT.includes('Action Space v1-frozen')}`);
console.log(`P4 buildSystemPrompt() deterministic: ${buildSystemPrompt() === COMPUTER_USE_PROMPT && buildSystemPrompt() === buildSystemPrompt()}`);
console.log(`P4 prompt bytes: ${Buffer.byteLength(COMPUTER_USE_PROMPT, 'utf8')}`);
const p4ok =
  missing.length === 0 && ACTION_LINES.length === 9 &&
  COMPUTER_USE_PROMPT.includes('Action Space v1-frozen') &&
  COMPUTER_USE_PROMPT.includes("<|box_start|>(x,y)<|box_end|>") &&
  buildSystemPrompt() === COMPUTER_USE_PROMPT;
check(
  'P4 COMPUTER_USE prompt is declared and contains the Scope A action space block: all 9 frozen actions rendered from the Scope A table (box literal, enum directions), version line v1-frozen, static across calls',
  p4ok,
  `actions=${ACTION_LINES.length} missing=${JSON.stringify(missing)} deterministic=${buildSystemPrompt() === COMPUTER_USE_PROMPT}`
);
console.log('');

// ---------------------------------------------------------------------------
// P5 — provider error -> E_VLM_ERROR; malformed -> E_VLM_MALFORMED;
//      unconfigured -> E_VLM_UNAVAILABLE
// ---------------------------------------------------------------------------
const v5throw = createVlm({ client: makeQueueClient([new Error('HTTP 500 from VLM endpoint')]) });
const e5a = codeOf(() => v5throw.infer({ image: RED_PNG, instruction: 'x' }));
const v5err = createVlm({ client: makeQueueClient([{ error: { message: 'rate limited', type: 'server_error' } }]) });
const e5b = codeOf(() => v5err.infer({ image: RED_PNG, instruction: 'x' }));
const v5empty = createVlm({ client: makeQueueClient([{ choices: [] }]) });
const e5c = codeOf(() => v5empty.infer({ image: RED_PNG, instruction: 'x' }));
const v5noact = createVlm({ client: makeQueueClient([{ choices: [{ message: { role: 'assistant', content: 'I see a login screen but cannot assist with that.' } }] }]) });
const e5d = codeOf(() => v5noact.infer({ image: RED_PNG, instruction: 'x' }));
const e5e = codeOf(() => createVlm().infer({ image: RED_PNG, instruction: 'x' }));
console.log(`P5 client throws -> ${e5a && e5a.code} (${e5a && e5a.message})`);
console.log(`P5 error-shaped response -> ${e5b && e5b.code} (${e5b && e5b.message})`);
console.log(`P5 empty choices -> ${e5c && e5c.code}`);
console.log(`P5 content without action line -> ${e5d && e5d.code}`);
console.log(`P5 unconfigured -> ${e5e && e5e.code}`);
const p5ok =
  e5a?.code === 'E_VLM_ERROR' && e5b?.code === 'E_VLM_ERROR' &&
  e5c?.code === 'E_VLM_MALFORMED' && e5d?.code === 'E_VLM_MALFORMED' &&
  e5e?.code === 'E_VLM_UNAVAILABLE';
check(
  'P5 all three declared failure modes surface truthfully: transport/error-shape -> E_VLM_ERROR (x2); no choices / no action line -> E_VLM_MALFORMED (x2); unconfigured -> E_VLM_UNAVAILABLE. No prediction is ever fabricated',
  p5ok,
  `throw=${e5a?.code} errShape=${e5b?.code} noChoices=${e5c?.code} noAction=${e5d?.code} unconfigured=${e5e?.code}`
);
console.log('');

// ---------------------------------------------------------------------------
// P6 — reset() clears history; subsequent infer() sends NO history turns
// ---------------------------------------------------------------------------
const stub6 = makeQueueClient([GOOD_RESPONSE, GOOD_RESPONSE, GOOD_RESPONSE]);
const vlm6 = createVlm({ client: stub6 });
vlm6.infer({ image: RED_PNG, instruction: 'step one' });
vlm6.infer({ image: RED_PNG, instruction: 'step two' });
const snap6 = vlm6.historySnapshot();
console.log(`P6 internal history after 2 infers: ${JSON.stringify(snap6)}`);
const r6 = vlm6.reset();
const snapAfterReset = vlm6.historySnapshot();
console.log(`P6 reset() raw: ${JSON.stringify(r6)}; snapshot after reset: ${JSON.stringify(snapAfterReset)}`);
vlm6.infer({ image: RED_PNG, instruction: 'step three' });
const req6 = stub6.calls[2];
const histMsgs6 = req6.messages.slice(1, -1);
console.log(`P6 post-reset request: messages=${req6.messages.length} (history pairs=${histMsgs6.length}); dropped audit after reset: ${JSON.stringify(vlm6.droppedTurns())}`);
const snapAfterThird = vlm6.historySnapshot();
const p6ok =
  snap6.length === 2 && snap6[0].instruction === 'step one' && snap6[1].prediction === PREDICTION_2 &&
  r6.cleared === 2 && snapAfterReset.length === 0 &&
  req6.messages.length === 2 && histMsgs6.length === 0 &&
  snapAfterThird.length === 1 && snapAfterThird[0].instruction === 'step three' &&
  vlm6.droppedTurns().length === 0;
check(
  'P6 reset() clears internal history (returns cleared:2); the next infer() request carries system + current user only — zero history pairs, empty audit',
  p6ok,
  `before=${snap6.length} turns; reset=${JSON.stringify(r6)}; postResetRequestMessages=${req6.messages.length}; postThirdInferSnapshot=${JSON.stringify(snapAfterThird.map((t) => t.instruction))}`
);
console.log('');

// ---------------------------------------------------------------------------
// P7 — determinism: same image + instruction + history twice ->
//      byte-identical request payload (with and without reset between)
// ---------------------------------------------------------------------------
const H7 = [
  { instruction: 'turn-a', prediction: 'wait()' },
  { instruction: 'turn-b', prediction: "finished(content='done')" },
];
const stub7 = makeQueueClient([GOOD_RESPONSE, GOOD_RESPONSE, GOOD_RESPONSE, GOOD_RESPONSE]);
const vlm7 = createVlm({ client: stub7, model: 'determinism-model' });
vlm7.reset();
vlm7.infer({ image: RED_PNG, instruction: 'same instruction', history: H7 });
vlm7.reset();
vlm7.infer({ image: RED_PNG, instruction: 'same instruction', history: H7 });
vlm7.infer({ image: RED_PNG, instruction: 'same instruction', history: H7 });
vlm7.infer({ image: RED_PNG, instruction: 'same instruction', history: H7 });
const p7str = stub7.calls.map((c) => JSON.stringify(c));
console.log(`P7 payload bytes: ${p7str.map((s) => s.length).join(' | ')}`);
console.log(`P7 all four payloads byte-identical: ${p7str.every((s) => s === p7str[0])}`);
const req7 = stub7.calls[0];
console.log(`P7 payload keys raw: ${JSON.stringify(Object.keys(req7))}; messages=${req7.messages.length} temperature=${req7.temperature} stream=${req7.stream} model=${req7.model}`);
const br1 = JSON.stringify(vlm7.buildRequest({ image: RED_PNG, instruction: 'same instruction', history: H7 }));
const br2 = JSON.stringify(vlm7.buildRequest({ image: RED_PNG, instruction: 'same instruction', history: H7 }));
console.log(`P7 buildRequest (no transport) deterministic: ${br1 === br2}`);
const p7ok =
  p7str.length === 4 && p7str.every((s) => s === p7str[0]) &&
  req7.model === 'determinism-model' && req7.temperature === 0 && req7.stream === false &&
  req7.messages.length === 1 + 2 * H7.length + 1 &&
  br1 === br2;
check(
  'P7 determinism: same image + instruction + history -> byte-identical request payload across 4 calls (with and without reset between), and buildRequest alone reproduces the identical bytes with zero transport',
  p7ok,
  `payloads=${p7str.length} identical=${p7str.every((s) => s === p7str[0])} bytes=${p7str[0].length} buildRequestEq=${br1 === br2}`
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
  'P8 zone discipline: only computer/** + scripts/phase29-* in git status (no Scope A-D file touched)',
  zoneOk,
  `${lines.length} path(s): ${lines.map((l) => l.slice(3).trim()).join(' | ')}`
);
console.log('');

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log('---------------------------------------------');
console.log(`SCOPE E: ${8 - failures}/8 PASS, ${failures} FAIL`);
if (failures > 0) process.exit(1);

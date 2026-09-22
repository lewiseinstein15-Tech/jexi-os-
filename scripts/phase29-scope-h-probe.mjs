#!/usr/bin/env node
// scripts/phase29-scope-h-probe.mjs
// Phase 29 — Scope H live probe: GUI tool call engine (strategies + selector).
// Zero dependencies, zero network: pure deterministic parsing over declared
// tables. Raw output per check. Exit 1 on any failure.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  createEngine,
  selectEngine,
  engineFor,
  listProviders,
  GUI_TOOL_NAMES,
  CODE_TOOL_NAMES,
  TOOL_CALL_CODES,
} from '../computer/tool-call/index.js';
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
    return null;
  } catch (e) {
    return e instanceof ComputerError ? e.code : `NON_COMPUTER_ERROR:${e && e.constructor && e.constructor.name}`;
  }
}

function sha16(s) {
  return createHash('sha256').update(s).digest('hex').slice(0, 16);
}

// ---------------------------------------------------------------------------
// Fixtures (deterministic)
// ---------------------------------------------------------------------------
const GUI_RESPONSE =
  "Thought: I will click the button.\n<computer_env>\nclick(start_box='<|box_start|>(120,240)<|box_end|>')\n</computer_env>";
const GUI_RESPONSE_ENVELOPE = {
  choices: [{ index: 0, message: { role: 'assistant', content: GUI_RESPONSE }, finish_reason: 'stop' }],
};
const NATIVE_RESPONSE = {
  choices: [
    {
      index: 0,
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [{ type: 'function', function: { name: 'bash', arguments: '{"command":"ls -la"}' } }],
      },
      finish_reason: 'tool_calls',
    },
  ],
};
const STRUCTURED_RESPONSE = {
  choices: [{ index: 0, message: { role: 'assistant', content: '{"name":"bash","arguments":{"command":"ls"}}' }, finish_reason: 'stop' }],
};
const NATIVE_PARAMS = {
  messages: [{ role: 'user', content: 'do the thing' }],
  tools: [
    { name: 'click', description: 'Click at a point', parameters: { type: 'object', properties: { start_box: { type: 'string' } }, required: ['start_box'] } },
    'read_file',
  ],
};

console.log('=== SCOPE H PROBE — GUI tool call engine ===');
console.log(`node ${process.version}`);
console.log(`declared codes: ${TOOL_CALL_CODES.join(' | ')} (ComputerError; E_INVALID_ARGUMENT reused; Scope A grammar codes propagate unchanged)`);
console.log(`declared providers raw: ${JSON.stringify(listProviders())}`);
console.log(`GUI_TOOL_NAMES (${GUI_TOOL_NAMES.length}): ${GUI_TOOL_NAMES.join(', ')}`);
console.log(`CODE_TOOL_NAMES (${CODE_TOOL_NAMES.length}): ${CODE_TOOL_NAMES.join(', ')}`);
console.log('network: none — declarative strategy engines only; deterministic (no clock, no randomness)');
console.log('');

// ---------------------------------------------------------------------------
// P1 — Selector picks the GUI engine (priority 90) for a GUI tool or a
//      <computer_env> tag. Show priority + chosen strategy.
// ---------------------------------------------------------------------------
const selClick = selectEngine({ tools: ['click'] });
const selNavigate = selectEngine({ tools: ['navigate'] });
const selEnvTag = selectEngine({ tools: ['mystery_tool'], prompt: 'the env follows <computer_env> ...' });
const selEnvFlag = selectEngine({ hasEnvTag: true });
console.log(`P1 click raw: ${JSON.stringify(selClick)}`);
console.log(`P1 navigate raw: ${JSON.stringify(selNavigate)}`);
console.log(`P1 env-tag(raw prompt) raw: ${JSON.stringify(selEnvTag)}`);
console.log(`P1 env-tag(flag) raw: ${JSON.stringify(selEnvFlag)}`);
const composed = engineFor({ tools: ['click'] });
console.log(`P1 engineFor raw: selection=${JSON.stringify(composed.selection)} engineStrategy=${composed.engine.strategy}`);
const p1ok =
  selClick.id === 'gui' && selClick.strategy === 'prompt' && selClick.priority === 90 && selClick.reason === 'gui-actions' &&
  selNavigate.id === 'gui' && selNavigate.priority === 90 && selNavigate.reason === 'gui-actions' &&
  selEnvTag.id === 'gui' && selEnvTag.priority === 90 && selEnvTag.reason === 'env-tag' &&
  selEnvFlag.id === 'gui' && selEnvFlag.priority === 90 && selEnvFlag.reason === 'env-tag' &&
  composed.selection.id === 'gui' && composed.engine.strategy === 'prompt' &&
  ['preparePrompt', 'prepareRequest', 'parseStreaming', 'parseFinal'].every((m) => typeof composed.engine[m] === 'function');
check(
  'P1 GUI selection: click (Scope A action) and navigate (GUI family) both select the GUI engine — strategy prompt, priority 90, reason gui-actions; a <computer_env> tag in the prompt or hasEnvTag:true selects it via reason env-tag even with a non-GUI tool; engineFor composes selection -> prompt engine with the full 4-method contract',
  p1ok,
  `click=${selClick.priority}/${selClick.strategy} navigate=${selNavigate.priority}/${selNavigate.strategy} envTag=${selEnvTag.reason} flag=${selEnvFlag.reason} composed=${composed.engine.strategy}`
);
console.log('');

// ---------------------------------------------------------------------------
// P2 — Selector picks the Code engine (priority 80) for code tools. Show
//      priority + chosen strategy. GUI beats code when mixed (90 > 80).
// ---------------------------------------------------------------------------
const selBash = selectEngine({ tools: ['bash'] });
const selRead = selectEngine({ tools: ['read_file'] });
const selBoth = selectEngine({ tools: ['bash', 'read_file'] });
const selMixed = selectEngine({ tools: ['click', 'bash'] });
const composedCode = engineFor({ tools: ['read_file'] });
console.log(`P2 bash raw: ${JSON.stringify(selBash)}`);
console.log(`P2 read_file raw: ${JSON.stringify(selRead)}`);
console.log(`P2 bash+read_file raw: ${JSON.stringify(selBoth)}`);
console.log(`P2 click+bash raw: ${JSON.stringify(selMixed)}`);
console.log(`P2 engineFor raw: selection=${JSON.stringify(composedCode.selection)} engineStrategy=${composedCode.engine.strategy}`);
const p2ok =
  selBash.id === 'code' && selBash.strategy === 'native' && selBash.priority === 80 && selBash.reason === 'code-tools' &&
  selRead.id === 'code' && selRead.priority === 80 &&
  selBoth.id === 'code' && selBoth.priority === 80 &&
  selMixed.id === 'gui' && selMixed.priority === 90 && selMixed.reason === 'gui-actions' &&
  composedCode.selection.id === 'code' && composedCode.engine.strategy === 'native';
check(
  'P2 Code selection: bash and read_file both select the Code engine — strategy native, priority 80, reason code-tools; a code-only set stays code; a GUI+code mixed set selects the GUI engine because 90 > 80 (priority-based, declared)',
  p2ok,
  `bash=${selBash.priority}/${selBash.strategy} read_file=${selRead.priority}/${selRead.strategy} mixedGuiWins=${selMixed.id}@${selMixed.priority} composed=${composedCode.engine.strategy}`
);
console.log('');

// ---------------------------------------------------------------------------
// P3 — Selector falls back to native (priority 0) for an unknown tool / an
//      empty / absent tool set.
// ---------------------------------------------------------------------------
const selUnknown = selectEngine({ tools: ['unknown_widget'] });
const selEmpty = selectEngine({ tools: [] });
const selNone = selectEngine({});
console.log(`P3 unknown raw: ${JSON.stringify(selUnknown)}`);
console.log(`P3 empty raw: ${JSON.stringify(selEmpty)}`);
console.log(`P3 absent raw: ${JSON.stringify(selNone)}`);
const p3ok =
  selUnknown.id === 'native' && selUnknown.strategy === 'native' && selUnknown.priority === 0 && selUnknown.reason === 'fallback' &&
  selEmpty.id === 'native' && selEmpty.priority === 0 && selEmpty.reason === 'fallback' &&
  selNone.id === 'native' && selNone.priority === 0 && selNone.reason === 'fallback';
check(
  'P3 native fallback: an unknown tool name, an empty tool set, and an absent input all fall through to the native default — strategy native, priority 0, reason fallback (declared default)',
  p3ok,
  `unknown=${selUnknown.priority}/${selUnknown.strategy}/${selUnknown.reason} empty=${selEmpty.reason} absent=${selNone.reason}`
);
console.log('');

// ---------------------------------------------------------------------------
// P4 — prompt strategy: preparePrompt puts the tool schema inside the
//      <computer_env> segment; parseFinal parses a <computer_env> tag block
//      into actions; streaming over chunks converges to the same actions.
// ---------------------------------------------------------------------------
const promptEng = createEngine('prompt');
const segments = promptEng.preparePrompt(['click', 'type']);
const segContent = segments.length === 1 ? segments[0].content : '';
console.log(`P4 promptSegments raw: count=${segments.length} tag=${segments[0] && segments[0].tag} sha256[16]=${sha16(segContent)}`);
console.log(`P4 segment content raw:\n${segContent}`);
const finalParsed = promptEng.parseFinal(GUI_RESPONSE_ENVELOPE);
console.log(`P4 parseFinal raw: ${JSON.stringify(finalParsed.actions)}`);
let streamActions = [];
let streamState = null;
for (let i = 0; i < GUI_RESPONSE.length; i += 7) {
  const r = promptEng.parseStreaming(GUI_RESPONSE.slice(i, i + 7), streamState);
  streamState = r.state;
  streamActions = streamActions.concat(r.actions);
}
console.log(`P4 parseStreaming raw: chunks=${Math.ceil(GUI_RESPONSE.length / 7)} actions=${JSON.stringify(streamActions)} state=${JSON.stringify(streamState)}`);
const p4ok =
  segments.length === 1 && segments[0].type === 'text' && segments[0].tag === 'computer_env' &&
  segContent.includes('<computer_env>') && segContent.includes('</computer_env>') &&
  segContent.includes('<tool name="click">') && segContent.includes('"kind":"box"') &&
  segContent.includes('<tool name="type">') && segContent.includes('"kind":"text"') &&
  finalParsed.actions.length === 1 &&
  finalParsed.actions[0].action === 'click' &&
  JSON.stringify(finalParsed.actions[0].args) === JSON.stringify({ start_box: { x: 120, y: 240 } }) &&
  typeof finalParsed.actions[0].raw === 'string' && finalParsed.actions[0].raw.startsWith('click(') &&
  JSON.stringify(streamActions) === JSON.stringify(finalParsed.actions);
check(
  'P4 prompt strategy round-trip: preparePrompt renders one <computer_env> segment whose content embeds the Scope A arg schema per GUI tool (kind:box for click, kind:text for type); parseFinal extracts the tag block from an OpenAI envelope and parses the action line through the real Scope A parser (click @ 120,240); streaming the same response in 7-char chunks yields byte-identical actions',
  p4ok,
  `segmentSha=${sha16(segContent)} actions=${JSON.stringify(finalParsed.actions.map((a) => ({ action: a.action, args: a.args })))} streamingIdentical=${JSON.stringify(streamActions) === JSON.stringify(finalParsed.actions)}`
);
console.log('');

// ---------------------------------------------------------------------------
// P5 — native strategy: prepareRequest emits the OpenAI function-calling
//      shape. Show the full request.
// ---------------------------------------------------------------------------
const nativeEng = createEngine('native');
const request = nativeEng.prepareRequest(NATIVE_PARAMS);
console.log(`P5 prepareRequest raw: ${JSON.stringify(request)}`);
const EXPECT_REQUEST = {
  messages: [{ role: 'user', content: 'do the thing' }],
  tools: [
    { type: 'function', function: { name: 'click', description: 'Click at a point', parameters: { type: 'object', properties: { start_box: { type: 'string' } }, required: ['start_box'] } } },
    { type: 'function', function: { name: 'read_file', description: '', parameters: { type: 'object', properties: {}, required: [] } } },
  ],
  tool_choice: 'auto',
};
const nativeParsed = nativeEng.parseFinal(NATIVE_RESPONSE);
console.log(`P5 parseFinal raw: ${JSON.stringify(nativeParsed.actions)}`);
const nativePromptSegments = nativeEng.preparePrompt(['click']);
console.log(`P5 preparePrompt raw: ${JSON.stringify(nativePromptSegments)} (declared: native carries no prompt segments)`);
const p5ok =
  JSON.stringify(request) === JSON.stringify(EXPECT_REQUEST) &&
  request.tool_choice === 'auto' &&
  nativeParsed.actions.length === 1 &&
  nativeParsed.actions[0].action === 'bash' &&
  JSON.stringify(nativeParsed.actions[0].args) === JSON.stringify({ command: 'ls -la' }) &&
  Array.isArray(nativePromptSegments) && nativePromptSegments.length === 0;
check(
  'P5 native strategy: prepareRequest emits the OpenAI function-calling shape — tools wrapped as { type:function, function:{ name, description, parameters } } (string entry read_file gets the empty object schema, tool_choice auto), messages passthrough, byte-equal to the declared literal; parseFinal decodes tool_calls into actions; preparePrompt is [] by declaration',
  p5ok,
  `requestSha=${sha16(JSON.stringify(request))} actions=${JSON.stringify(nativeParsed.actions)} promptSegments=${nativePromptSegments.length}`
);
console.log('');

// ---------------------------------------------------------------------------
// P6 — Unknown strategy name -> E_UNKNOWN_TOOL_CALL_ENGINE.
// ---------------------------------------------------------------------------
const u1 = codeOf(() => createEngine('nope'));
const u2 = codeOf(() => createEngine(42));
const u3 = codeOf(() => selectEngine({ tools: [42] }));
console.log(`P6 raw: createEngine('nope')->${u1} createEngine(42)->${u2} selectEngine({tools:[42]})->${u3}`);
const p6ok = u1 === 'E_UNKNOWN_TOOL_CALL_ENGINE' && u2 === 'E_UNKNOWN_TOOL_CALL_ENGINE' && u3 === 'E_INVALID_ARGUMENT';
check(
  'P6 E_UNKNOWN_TOOL_CALL_ENGINE: unknown string and non-string strategy names are refused with E_UNKNOWN_TOOL_CALL_ENGINE (registry: native, prompt, structured); a malformed tool entry is refused with the reused E_INVALID_ARGUMENT (misuse discipline)',
  p6ok,
  `nope=${u1} nonString=${u2} badToolEntry=${u3}`
);
console.log('');

// ---------------------------------------------------------------------------
// P7 — Determinism: same tools + same response twice -> byte-identical
//      actions (and byte-identical prompt/request builds) across all three
//      strategies.
// ---------------------------------------------------------------------------
function runPass() {
  const p = createEngine('prompt');
  const n = createEngine('native');
  const s = createEngine('structured');
  const segs = JSON.stringify(p.preparePrompt(['click', 'type']));
  const pf = JSON.stringify(p.parseFinal(GUI_RESPONSE).actions);
  let st;
  let sa = [];
  for (let i = 0; i < GUI_RESPONSE.length; i += 7) {
    const r = p.parseStreaming(GUI_RESPONSE.slice(i, i + 7), st);
    st = r.state;
    sa = sa.concat(r.actions);
  }
  const req = JSON.stringify(n.prepareRequest(NATIVE_PARAMS));
  const nf = JSON.stringify(n.parseFinal(NATIVE_RESPONSE).actions);
  const sreq = JSON.stringify(s.prepareRequest(NATIVE_PARAMS));
  const sf = JSON.stringify(s.parseFinal(STRUCTURED_RESPONSE).actions);
  return { segs, pf, sa: JSON.stringify(sa), req, nf, sreq, sf };
}
const passA = runPass();
const passB = runPass();
const pairs = ['segs', 'pf', 'sa', 'req', 'nf', 'sreq', 'sf'];
const identical = pairs.map((k) => passA[k] === passB[k]);
console.log(`P7 pass A raw: sha256[16]={segs:${sha16(passA.segs)} pf:${sha16(passA.pf)} sa:${sha16(passA.sa)} req:${sha16(passA.req)} nf:${sha16(passA.nf)} sreq:${sha16(passA.sreq)} sf:${sha16(passA.sf)}}`);
console.log(`P7 pass B raw: identical=${JSON.stringify(identical)} (all seven byte comparisons)`);
const p7ok = identical.every(Boolean);
check(
  'P7 determinism: two independent passes over the same tools + responses produce byte-identical results in all seven comparisons — prompt segment, prompt parseFinal actions, streaming-accumulated actions, native request, native actions, structured request, structured actions',
  p7ok,
  `identical=${JSON.stringify(identical)} pfSha=${sha16(passA.pf)} nfSha=${sha16(passA.nf)} sfSha=${sha16(passA.sf)}`
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
  'P8 zone discipline: only computer/** + scripts/phase29-* in git status (no Scope A-G file touched)',
  zoneOk,
  `${lines.length} path(s): ${lines.map((l) => l.slice(3).trim()).join(' | ')}`
);
console.log('');

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log('---------------------------------------------');
console.log(`SCOPE H: ${8 - failures}/8 PASS, ${failures} FAIL`);
if (failures > 0) process.exit(1);

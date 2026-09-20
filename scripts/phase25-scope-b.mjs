#!/usr/bin/env node
// scripts/phase25-scope-b.mjs
// Phase 25 — Scope B live probe: dynamic boundary + cache marker.
// Zero dependencies. Prints raw evidence per check. Exit 1 on any failure.

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

import { createSectionRegistry } from '../prompt/assembly/registry.js';
import { registerCanonical } from '../prompt/assembly/order.js';
import {
  compute, cacheKey, assertOrder, boundary, BOUNDARY_SEPARATOR,
} from '../prompt/assembly/boundary.js';
import { PromptError, isPromptError } from '../prompt/assembly/errors.js';

let failures = 0;

function check(name, ok, evidence) {
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}`);
  console.log(`        ${evidence}`);
  if (!ok) failures += 1;
}

function expectCode(fn) {
  try {
    fn();
    return { threw: false, got: null, err: null };
  } catch (err) {
    return { threw: true, got: err?.code ?? null, err };
  }
}

console.log('=== SCOPE B PROBE — dynamic boundary + cache marker ===');
console.log(`node ${process.version}`);
console.log('');

// Canonical ctx: every section gets a distinct, realistic string.
const CTX_A = {
  identity: 'You are JEXI.',
  'output-style': 'Terse, evidence-first.',
  'system-rules': 'Refuse outside zone. Never fake output.',
  'doing-tasks': 'One commit per scope. Probe before claim.',
  actions: 'Act through registered tools only.',
  environment: 'sandbox: linux, node 24',
  'project-context': 'repo: jexi-os, main 8b713cd',
  instructions: 'AGENTS.md tree loaded verbatim.',
  'runtime-config': 'model: glm, temperature: 0',
  'session-guidance': 'Report raw. Stop after scope.',
};

function buildCanonical(ctx) {
  const reg = registerCanonical(createSectionRegistry());
  return reg.list().map((s) => ({ id: s.id, kind: s.kind, content: s.build(ctx) }));
}

const sectionsA = buildCanonical(CTX_A);

// --- P1: compute on the 10 canonical sections ---
const b1 = compute(sectionsA);
const staticTextA = sectionsA.filter((s) => s.kind === 'static').map((s) => s.content).join('\n');
const dynamicTextA = sectionsA.filter((s) => s.kind === 'dynamic').map((s) => s.content).join('\n');
const expectedStaticEnd = Buffer.byteLength(staticTextA, 'utf8');
const p1 =
  b1.valid === true &&
  b1.staticEnd === expectedStaticEnd &&
  b1.dynamicStart === b1.staticEnd + 1 &&
  typeof b1.cacheKey === 'string' &&
  /^[0-9a-f]{64}$/.test(b1.cacheKey) &&
  boundary.compute === compute &&
  assertOrder(sectionsA) === true;
check(
  'P1 compute(10 canonical) -> boundary descriptor, staticEnd == byte length of static block',
  p1,
  `descriptor=${JSON.stringify(b1)}; expectedStaticEnd=${expectedStaticEnd} (independent recompute); ` +
  `staticEnd==byteLength(static join)=${b1.staticEnd === expectedStaticEnd}; ` +
  `dynamicStart==staticEnd+1=${b1.dynamicStart === b1.staticEnd + 1}; ` +
  `charCounts+separator==total(${staticTextA.length + dynamicTextA.length + 1})=${b1.staticCharCount + b1.dynamicCharCount + 1 === staticTextA.length + dynamicTextA.length + 1}; ` +
  `assertOrder(valid list)===true; boundary.compute===compute`
);

// --- P2: cacheKey stability (in-process x2, manual sha256, fresh process) ---
const staticInput = [
  { id: 'identity', kind: 'static', content: 'You are JEXI.' },
  { id: 'output-style', kind: 'static', content: 'Terse, evidence-first.' },
];
const k1 = cacheKey(staticInput);
const k2 = cacheKey([...staticInput]);
const manualSha = createHash('sha256').update('You are JEXI.\nTerse, evidence-first.', 'utf8').digest('hex');
const boundaryHref = new URL('../prompt/assembly/boundary.js', import.meta.url).href;
const childCode = `
import { cacheKey } from ${JSON.stringify(boundaryHref)};
const s = [
  { id: 'identity', kind: 'static', content: 'You are JEXI.' },
  { id: 'output-style', kind: 'static', content: 'Terse, evidence-first.' },
];
console.log(cacheKey(s));
`;
const child = spawnSync(process.execPath, ['--input-type=module', '-e', childCode], { encoding: 'utf8', timeout: 20000 });
const childHash = child.status === 0 ? child.stdout.trim() : `(spawn failed: ${child.stderr.slice(0, 200)})`;
const p2 = child.status === 0 && k1 === k2 && k1 === manualSha && k1 === childHash;
check(
  'P2 cacheKey stable: same input twice + manual sha256 + FRESH PROCESS all identical',
  p2,
  `in-process k1 =${k1}; in-process k2 (fresh array)=${k2}; manual sha256=${manualSha}; ` +
  `fresh-process=${childHash}; childExit=${child.status}; all-equal=${k1 === k2 && k1 === manualSha && k1 === childHash}`
);

// --- P3: cacheKey excludes dynamic ---
const CTX_B = { ...CTX_A, environment: 'sandbox: linux, node 24, egress: partial' };
const sectionsB = buildCanonical(CTX_B);
const b2 = compute(sectionsB);
const p3 =
  b2.cacheKey === b1.cacheKey &&
  b2.staticEnd === b1.staticEnd &&
  b2.dynamicCharCount !== b1.dynamicCharCount;
check(
  'P3 dynamic-only change -> cacheKey UNCHANGED, staticEnd UNCHANGED, dynamicCharCount CHANGED',
  p3,
  `environment A=${JSON.stringify(CTX_A.environment)} -> B=${JSON.stringify(CTX_B.environment)}; ` +
  `cacheKey A=${b1.cacheKey} B=${b2.cacheKey} equal=${b2.cacheKey === b1.cacheKey}; ` +
  `staticEnd A=${b1.staticEnd} B=${b2.staticEnd}; dynamicCharCount A=${b1.dynamicCharCount} B=${b2.dynamicCharCount}`
);

// --- P4: cacheKey tracks static (same-length edit still moves the hash) ---
const CTX_C = { ...CTX_A, identity: 'Y0u ar3 JEXI.' };
const sectionsC = buildCanonical(CTX_C);
const b3 = compute(sectionsC);
const p4 =
  b3.cacheKey !== b1.cacheKey &&
  b3.staticEnd === b1.staticEnd &&
  /^[0-9a-f]{64}$/.test(b3.cacheKey);
check(
  'P4 static change -> cacheKey CHANGES (even at identical byte length)',
  p4,
  `identity A=${JSON.stringify(CTX_A.identity)} -> C=${JSON.stringify(CTX_C.identity)} (both ${CTX_A.identity.length} chars); ` +
  `cacheKey A=${b1.cacheKey} C=${b3.cacheKey} differ=${b3.cacheKey !== b1.cacheKey}; ` +
  `staticEnd A=${b1.staticEnd} C=${b3.staticEnd} (equal, as expected for same-length edit)`
);

// --- P5: order violation refused ---
const badPair = [
  { id: 'environment', kind: 'dynamic', content: 'E' },
  { id: 'identity', kind: 'static', content: 'I' },
];
const shuffled10 = (() => {
  const arr = sectionsA.map((s) => ({ ...s }));
  const identityIdx = arr.findIndex((s) => s.id === 'identity');
  const [identitySection] = arr.splice(identityIdx, 1);
  const envIdx = arr.findIndex((s) => s.id === 'environment');
  arr.splice(envIdx + 1, 0, identitySection);
  return arr;
})();
const r5a = expectCode(() => compute(badPair));
const r5b = expectCode(() => compute(shuffled10));
const r5c = expectCode(() => assertOrder(badPair));
const p5 =
  r5a.threw && r5a.got === 'E_STATIC_AFTER_DYNAMIC' &&
  r5b.threw && r5b.got === 'E_STATIC_AFTER_DYNAMIC' &&
  r5c.threw && r5c.got === 'E_STATIC_AFTER_DYNAMIC';
check(
  'P5 static-after-dynamic refused with E_STATIC_AFTER_DYNAMIC (compute x2 shapes + assertOrder)',
  p5,
  `pair[env(dyn), identity(static)] -> ${r5a.got} (details=${JSON.stringify(r5a.err?.details)}); ` +
  `shuffled-10 identity moved after environment -> ${r5b.got}; assertOrder(same pair) -> ${r5c.got}`
);

// --- P6: real byte offset ---
const six = [
  { id: 'identity', kind: 'static', content: 'AAAA' },
  { id: 'environment', kind: 'dynamic', content: 'BBBB' },
];
const b6 = compute(six);
const fullText = 'AAAA' + BOUNDARY_SEPARATOR + 'BBBB';
const p6 =
  b6.staticEnd === 4 &&
  b6.dynamicStart === 5 &&
  fullText.charCodeAt(4) === 10 &&
  fullText[5] === 'B' &&
  fullText.slice(0, 4) === 'AAAA' &&
  fullText.slice(5) === 'BBBB';
check(
  'P6 real byte offset: static "AAAA" + dynamic "BBBB" -> staticEnd===4, separator byte AT 4, first B AT 5',
  p6,
  `descriptor=${JSON.stringify(b6)}; fullText=${JSON.stringify(fullText)}; ` +
  `fullText[4]=\\n(charCode ${fullText.charCodeAt(4)}); fullText[5]=${JSON.stringify(fullText[5])}`
);
// P6b: byte offset vs char count diverge under UTF-8
const sixB = [
  { id: 'identity', kind: 'static', content: '\u00C9A' },
  { id: 'environment', kind: 'dynamic', content: 'BBBB' },
];
const b6b = compute(sixB);
const p6b =
  b6b.staticEnd === 3 &&
  b6b.staticCharCount === 2 &&
  b6b.dynamicStart === 4;
check(
  'P6b static "\\u00C9A" (2 chars, 3 UTF-8 bytes) -> staticEnd=3 BYTES vs staticCharCount=2 CHARS',
  p6b,
  `descriptor=${JSON.stringify(b6b)}; byteLength=${Buffer.byteLength('\u00C9A', 'utf8')}; charLength=${'\u00C9A'.length}`
);

// --- P7: empty sections list ---
const b7 = compute([]);
const emptySha = createHash('sha256').update('', 'utf8').digest('hex');
const p7 =
  b7.valid === true &&
  b7.staticEnd === 0 &&
  b7.dynamicStart === 1 &&
  b7.staticCharCount === 0 &&
  b7.dynamicCharCount === 0 &&
  b7.cacheKey === emptySha;
check(
  'P7 empty list -> valid:true, staticEnd=0, cacheKey=sha256("")',
  p7,
  `descriptor=${JSON.stringify(b7)}; expected empty sha256=${emptySha}`
);

// --- P8: adversarial malformed section; registry untouched ---
const reg8 = registerCanonical(createSectionRegistry());
const beforeIds = reg8.list().map((s) => s.id).join(',');
let err8 = null;
try {
  compute([{ id: 'x', content: 'y' }]);
} catch (e) {
  err8 = e;
}
let regDupErr = null;
try {
  reg8.register({ id: 'identity', label: 'dup', order: 99, kind: 'static', budget: { maxChars: 1, weight: 1 }, build: () => '' });
} catch (e) {
  regDupErr = e;
}
const p8 =
  err8 instanceof PromptError &&
  isPromptError(err8, 'E_INVALID_SECTION') &&
  err8.details?.index === 0 &&
  reg8.size() === 10 &&
  reg8.list().map((s) => s.id).join(',') === beforeIds &&
  regDupErr instanceof PromptError &&
  regDupErr.constructor === err8.constructor &&
  compute([]).valid === true;
check(
  'P8 malformed section (missing kind) -> E_INVALID_SECTION (Scope A error class); registry untouched; boundary reusable',
  p8,
  `threw=${err8 !== null} code=${err8?.code} instanceof-PromptError=${err8 instanceof PromptError} ` +
  `details=${JSON.stringify(err8?.details)}; registry.size()=${reg8.size()} ids-unchanged=${reg8.list().map((s) => s.id).join(',') === beforeIds}; ` +
  `registry-refusal-constructor===boundary-refusal-constructor=${regDupErr?.constructor === err8?.constructor}; compute([]) after refusal valid=${compute([]).valid}`
);

console.log('');
console.log(failures === 0 ? 'SCOPE B PROBE: ALL CHECKS PASS' : `SCOPE B PROBE: ${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);

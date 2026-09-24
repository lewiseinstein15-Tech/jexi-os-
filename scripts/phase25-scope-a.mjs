#!/usr/bin/env node
// scripts/phase25-scope-a.mjs
// Phase 25 — Scope A live probe: section registry + canonical order.
// Zero dependencies. Prints raw evidence per check. Exit 1 on any failure.

import {
  createSectionRegistry,
  isPromptError,
} from '../capabilities/prompts/assembly/registry.js';
import {
  CANONICAL_IDS,
  STATIC_SECTION_IDS,
  DYNAMIC_SECTION_IDS,
  registerCanonical,
} from '../capabilities/prompts/assembly/order.js';

const EXPECTED_ORDER = [
  'identity', 'output-style', 'system-rules', 'doing-tasks', 'actions',
  'environment', 'project-context', 'instructions', 'runtime-config',
  'session-guidance',
];

let failures = 0;

function check(name, ok, evidence) {
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}`);
  console.log(`        ${evidence}`);
  if (!ok) failures += 1;
}

function expectCode(fn) {
  try {
    fn();
    return { threw: false, got: null };
  } catch (err) {
    return { threw: true, isPrompt: isPromptError(err), got: err?.code ?? null };
  }
}

console.log('=== SCOPE A PROBE — prompt section registry ===');
console.log(`node ${process.version}`);
console.log('');

// --- A1: register all 10 canonical sections ---
const reg = createSectionRegistry();
registerCanonical(reg);
check(
  'A1 register all 10 canonical sections',
  reg.size() === 10,
  `registry.size()=${reg.size()} expected=10`
);

// --- A2: list() returns them in canonical order ---
const listed = reg.list();
const listedIds = listed.map((s) => s.id);
const ordersStrict = listed.every((s, i) => s.order === i + 1);
check(
  'A2 list() returns sections in canonical order 01..10',
  JSON.stringify(listedIds) === JSON.stringify(EXPECTED_ORDER) && ordersStrict,
  `ids=${JSON.stringify(listedIds)} orders=${JSON.stringify(listed.map((s) => s.order))}`
);

// --- A3: get('identity') returns the spec ---
const identity = reg.get('identity');
const identityOk =
  !!identity &&
  identity.kind === 'static' &&
  identity.order === 1 &&
  identity.label === 'Identity & Role' &&
  identity.budget.maxChars === 4000 &&
  typeof identity.build === 'function';
check(
  "A3 get('identity') returns the spec",
  identityOk,
  `get('identity')=${JSON.stringify({
    id: identity?.id,
    label: identity?.label,
    order: identity?.order,
    kind: identity?.kind,
    maxChars: identity?.budget?.maxChars,
    weight: identity?.budget?.weight,
    build: typeof identity?.build,
  })}`
);

// --- A3b: canonical build(ctx) passthrough works ---
const built = identity.build({ identity: 'You are JEXI.' });
check(
  'A3b canonical build(ctx) passthrough',
  built === 'You are JEXI.' && identity.build({}) === '',
  `build({identity:'You are JEXI.'})=${JSON.stringify(built)}; build({})=${JSON.stringify(identity.build({}))}`
);

// --- A4: duplicate ID refused with E_DUPLICATE_SECTION ---
const dup = expectCode(() => reg.register({ ...identity, id: 'identity', order: 11 }));
check(
  'A4 duplicate ID refused with E_DUPLICATE_SECTION',
  dup.threw && dup.isPrompt && dup.got === 'E_DUPLICATE_SECTION',
  `threw=${dup.threw} code=${dup.got}`
);

// --- A5: invalid order refused ---
const badOrderZero = expectCode(() =>
  reg.register({ id: 'bad-order-zero', label: 'Bad', order: 0, kind: 'static', budget: { maxChars: 100, weight: 1 }, build: () => '' })
);
const badOrderFrac = expectCode(() =>
  reg.register({ id: 'bad-order-frac', label: 'Bad', order: 2.5, kind: 'static', budget: { maxChars: 100, weight: 1 }, build: () => '' })
);
check(
  'A5 invalid order refused (order=0, order=2.5)',
  badOrderZero.got === 'E_INVALID_ORDER' && badOrderFrac.got === 'E_INVALID_ORDER',
  `order=0 -> ${badOrderZero.got}; order=2.5 -> ${badOrderFrac.got}`
);

// --- A5b: order slot collision refused ---
const collision = expectCode(() =>
  reg.register({ id: 'collider', label: 'Collider', order: 3, kind: 'dynamic', budget: { maxChars: 100, weight: 1 }, build: () => '' })
);
check(
  'A5b order slot already taken refused (slot 3 held by system-rules)',
  collision.threw && collision.isPrompt && collision.got === 'E_ORDER_COLLISION',
  `order=3 -> ${collision.got}`
);

// --- A6: adversarial extras — kind / build / budget validation ---
const badKind = expectCode(() =>
  reg.register({ id: 'bad-kind', label: 'Bad', order: 11, kind: 'sometimes', budget: { maxChars: 100, weight: 1 }, build: () => '' })
);
const badBuild = expectCode(() =>
  reg.register({ id: 'bad-build', label: 'Bad', order: 11, kind: 'static', budget: { maxChars: 100, weight: 1 }, build: 'nope' })
);
const badBudget = expectCode(() =>
  reg.register({ id: 'bad-budget', label: 'Bad', order: 11, kind: 'static', budget: { maxChars: -5, weight: 1 }, build: () => '' })
);
check(
  'A6 adversarial: invalid kind / build / budget all refused',
  badKind.got === 'E_INVALID_KIND' && badBuild.got === 'E_INVALID_BUILD' && badBudget.got === 'E_INVALID_BUDGET',
  `kind -> ${badKind.got}; build -> ${badBuild.got}; budget -> ${badBudget.got}`
);

// --- A7: unknown get() is null; refused registrations leave no residue ---
check(
  "A7 get(unknown) === null; failures left registry untouched",
  reg.get('no-such-section') === null && reg.size() === 10 && reg.get('collider') === null,
  `get('no-such-section')=${reg.get('no-such-section')}; size=${reg.size()}; get('collider')=${reg.get('collider')}`
);

// --- A8: canonical constants — 5 static + 5 dynamic, boundary between 05 and 06 ---
const kindsOk =
  STATIC_SECTION_IDS.length === 5 &&
  DYNAMIC_SECTION_IDS.length === 5 &&
  STATIC_SECTION_IDS.join(',') === 'identity,output-style,system-rules,doing-tasks,actions' &&
  DYNAMIC_SECTION_IDS.join(',') === 'environment,project-context,instructions,runtime-config,session-guidance';
check(
  'A8 canonical constants: 5 static (01-05) + 5 dynamic (06-10)',
  kindsOk,
  `static=[${STATIC_SECTION_IDS.join(', ')}] dynamic=[${DYNAMIC_SECTION_IDS.join(', ')}]`
);

console.log('');
console.log(failures === 0 ? 'SCOPE A PROBE: ALL CHECKS PASS' : `SCOPE A PROBE: ${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);

#!/usr/bin/env node
// scripts/phase25-scope-c.mjs
// Phase 25 — Scope C live probe: five-section constitutional template.
// Zero dependencies. Prints raw evidence per check. Exit 1 on any failure.

import { constitution, escalation, outputFormat, constraints, SCHEMA_DIALECT, CONSTITUTION_SECTION_MAP } from '../prompt/constitution/index.js';
import { createSectionRegistry } from '../prompt/assembly/registry.js';
import { registerCanonical } from '../prompt/assembly/order.js';
import { compute as computeBoundary } from '../prompt/assembly/boundary.js';
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

console.log('=== SCOPE C PROBE — five-section constitutional template ===');
console.log(`node ${process.version}`);
console.log('');

const SPEC = {
  id: 'researcher',
  role: 'Research Specialist',
  mission: 'Gather evidence and produce cited findings for JEXI tasks.',
  constraints: [
    "You won't fabricate sources, quotes, or data.",
    'You must not present inference as stated fact.',
    'You cannot access systems outside the sandbox.',
    'You will never expose credentials or tokens.',
  ],
  scope: {
    validTopics: ['web research', 'source verification', 'citation hygiene'],
    outOfScope: ['deploying code', 'modifying server configuration'],
    decisionBoundaries: [
      'You may choose search strategy inside valid topics.',
      'You may not expand scope beyond valid topics without explicit user instruction.',
    ],
  },
  // escalation omitted -> built-in named triggers
  // outputSchema omitted -> default researcher schema (draft 2020-12)
};

// --- P1: generate a constitution ---
const gen = constitution.generate(SPEC);
const s = gen.sections;
const sectionKeys = Object.keys(s).sort().join(',');
const fivePresent =
  sectionKeys === 'constraints,escalation,identity,outputFormat,scope' &&
  typeof s.identity === 'string' && s.identity.trim() !== '' &&
  typeof s.constraints === 'string' && s.constraints.trim() !== '' &&
  typeof s.scope === 'string' && s.scope.trim() !== '' &&
  typeof s.escalation === 'string' && s.escalation.trim() !== '' &&
  typeof s.outputFormat === 'object' && s.outputFormat !== null &&
  s.outputFormat.$schema === SCHEMA_DIALECT &&
  constitution.validate(gen).valid === true;
check(
  'P1 generate(researcher) -> 5 sections present + validate(gen).valid === true',
  fivePresent,
  `sectionKeys=${sectionKeys}; identity=${JSON.stringify(s.identity.slice(0, 60))}...; ` +
  `outputFormat.$schema=${s.outputFormat.$schema}; outputFormat.type=${s.outputFormat.type}; ` +
  `validate(gen)=${JSON.stringify(constitution.validate(gen))}\n--- RENDERED MARKDOWN BEGIN ---\n${gen.rendered}\n--- RENDERED MARKDOWN END ---`
);

// --- P2: soft language refused ---
const softSpec1 = { ...SPEC, constraints: [...SPEC.constraints, 'You should try to double-check every claim.'] };
const r2a = expectCode(() => constitution.generate(softSpec1));
const softSpec2 = { ...SPEC, constraints: [...SPEC.constraints, 'When possible, consider extra verification.'] };
const r2b = expectCode(() => constitution.generate(softSpec2));
const softSpec3 = { ...SPEC, constraints: [...SPEC.constraints, 'Be careful with sources.'] };
const r2c = expectCode(() => constitution.generate(softSpec3));
const p2 =
  r2a.threw && r2a.got === 'E_SOFT_LANGUAGE' && r2a.err?.details?.rule === 'forbidden-soft-word' &&
  r2b.threw && r2b.got === 'E_SOFT_LANGUAGE' && r2b.err?.details?.rule === 'forbidden-soft-word' &&
  r2c.threw && r2c.got === 'E_SOFT_LANGUAGE' && r2c.err?.details?.rule === 'missing-absolute-negation';
check(
  'P2 soft language refused with E_SOFT_LANGUAGE (forbidden words + missing absolute negation)',
  p2,
  `"should try..." -> ${r2a.got} details=${JSON.stringify(r2a.err?.details)}; ` +
  `"When possible, consider..." -> ${r2b.got} word=${r2b.err?.details?.word}; ` +
  `"Be careful with sources." (no negation) -> ${r2c.got} rule=${r2c.err?.details?.rule}`
);

// --- P3: escalation triggers named ---
const esc = s.escalation;
const TRIGGER_LINE_RE_LOCAL = /^- (REFUSE|ASK|ESCALATE) — [a-z0-9-]+: .+$/;
const TRIGGER_NAME_RE = /^- (?:REFUSE|ASK|ESCALATE) — ([a-z0-9-]+):/;
const triggerLines = esc.split('\n').filter((l) => l.startsWith('- '));
const names = triggerLines.map((l) => TRIGGER_NAME_RE.exec(l)?.[1] ?? null);
const allNamed = triggerLines.every((l) => TRIGGER_LINE_RE_LOCAL.test(l));
const vagueHits = ['when appropriate', 'if needed', 'as appropriate', 'when needed', 'if applicable', 'as needed']
  .filter((phrase) => esc.toLowerCase().includes(phrase));
const p3 =
  triggerLines.length === 6 &&
  allNamed &&
  names.every((n) => typeof n === 'string' && n.length > 0) &&
  vagueHits.length === 0;
check(
  'P3 every escalation trigger is a NAMED condition; zero vague phrases',
  p3,
  `triggerLines=${triggerLines.length}; names=${JSON.stringify(names)}; ` +
  `all match ^- (REFUSE|ASK|ESCALATE) — [a-z0-9-]+: .+$ =${allNamed}; ` +
  `vagueHits=${JSON.stringify(vagueHits)}\n--- ESCALATION SECTION BEGIN ---\n${esc}\n--- ESCALATION SECTION END ---`
);

// --- P4: escalation decisions ---
const dClear = escalation.check({ kind: 'summarize-page', clear: true });
const dRefuse = escalation.check({ kind: 'policy-violation' });
const dAsk = escalation.check({ kind: 'ambiguous-scope' });
const dEscalate = escalation.check({ kind: 'human-authority-required' });
const dAmbiguous = escalation.check({ kind: 'something-unmatched' });
const p4 =
  dClear.action === 'proceed' && dClear.trigger === 'explicit-clear' &&
  dRefuse.action === 'refuse' && dRefuse.trigger === 'policy-violation' &&
  dAsk.action === 'ask' && dAsk.trigger === 'ambiguous-scope' &&
  dEscalate.action === 'escalate' && dEscalate.trigger === 'human-authority-required' &&
  dAmbiguous.action === 'ask' && dAmbiguous.trigger === 'default-unclear';
check(
  'P4 escalation.check: clear->proceed, refuse->refuse, ask->ask, escalate->escalate, ambiguous->ask (default)',
  p4,
  `clear=${JSON.stringify(dClear)}\n        refuse=${JSON.stringify(dRefuse)}\n        ask=${JSON.stringify(dAsk)}\n        escalate=${JSON.stringify(dEscalate)}\n        ambiguous(no trigger, not clear)=${JSON.stringify(dAmbiguous)}`
);

// --- P5: output format validation ---
const probeSchema = {
  $schema: SCHEMA_DIALECT,
  title: 'probe-agent response',
  type: 'object',
  required: ['summary', 'confidence'],
  additionalProperties: false,
  properties: {
    summary: { type: 'string', minLength: 1 },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    tags: { type: 'array', items: { type: 'string' }, maxItems: 3 },
  },
};
const decl = outputFormat.declare('probe-agent', probeSchema);
const vOk = outputFormat.validate('probe-agent', { summary: 'ok', confidence: 0.9, tags: ['a'] });
const vBad = outputFormat.validate('probe-agent', { summary: '', confidence: 'high', tags: ['a', 'b', 'c', 'd'], extra: 1 });
const badKeywords = new Set(vBad.errors.map((e) => e.keyword));
const rUndeclared = expectCode(() => outputFormat.validate('never-declared', {}));
const rUnsupported = expectCode(() => outputFormat.declare('bad-agent', { type: 'object', anyOf: [] }));
const p5 =
  decl.declared === true &&
  vOk.valid === true && vOk.errors.length === 0 &&
  vBad.valid === false &&
  badKeywords.has('type') && badKeywords.has('minLength') && badKeywords.has('maxItems') && badKeywords.has('additionalProperties') &&
  rUndeclared.got === 'E_UNDECLARED_AGENT' &&
  rUnsupported.got === 'E_UNSUPPORTED_KEYWORD';
check(
  'P5 declare + strict validate: valid response ok; invalid response errors named; no coercion; undeclared/bad-schema refused',
  p5,
  `declare=${JSON.stringify(decl)}\n        valid response -> ${JSON.stringify(vOk)}\n        invalid response -> valid=${vBad.valid} errors=${JSON.stringify(vBad.errors, null, 0).slice(0, 600)}\n        undeclared agent -> ${rUndeclared.got}; anyOf schema -> ${rUnsupported.got}`
);

// --- P6: determinism ---
const gen2 = constitution.generate(SPEC);
const byteEqual = gen.rendered === gen2.rendered;
const sectionsEqual = JSON.stringify(gen.sections) === JSON.stringify(gen2.sections);
const p6 = byteEqual && sectionsEqual && Buffer.byteLength(gen.rendered) === Buffer.byteLength(gen2.rendered);
check(
  'P6 same spec twice -> byte-identical output (rendered + sections)',
  p6,
  `rendered byteLength=${Buffer.byteLength(gen.rendered)} both; byteEqual=${byteEqual}; sectionsEqual=${sectionsEqual}`
);

// --- P7: bad spec refused ---
const r7a = expectCode(() => constitution.generate({}));
const r7b = expectCode(() => constitution.generate({ role: 'X' }));
const r7c = expectCode(() => constitution.generate({ id: 'x', role: 'R' }));
const r7d = expectCode(() => constitution.generate({ id: 'x', role: 'R', constraints: ["You won't fake it."] }));
const p7 =
  r7a.got === 'E_MISSING_ROLE' &&
  r7b.got === 'E_MISSING_ID' &&
  r7c.got === 'E_MISSING_CONSTRAINTS' &&
  r7d.got === 'E_MISSING_SCOPE';
check(
  'P7 bad specs refused: {} -> E_MISSING_ROLE (lead example); missing id/constraints/scope each named',
  p7,
  `{} -> ${r7a.got}; {role} -> ${r7b.got}; {id,role} -> ${r7c.got}; {id,role,constraints} -> ${r7d.got}`
);

// --- P8: integration with Scope A registry + Scope B boundary ---
const reg = registerCanonical(createSectionRegistry());
const renderedOutput = outputFormat.renderSection(gen.sections.outputFormat);
const ctx = {
  [CONSTITUTION_SECTION_MAP.identity]: gen.sections.identity,
  [CONSTITUTION_SECTION_MAP.constraints]: gen.sections.constraints,
  [CONSTITUTION_SECTION_MAP.scope]: gen.sections.scope,
  [CONSTITUTION_SECTION_MAP.escalation]: gen.sections.escalation,
  [CONSTITUTION_SECTION_MAP.outputFormat]: renderedOutput,
};
const built = reg.list().map((sec) => ({ id: sec.id, kind: sec.kind, content: sec.build(ctx) }));
const bdesc = computeBoundary(built);
const mapping = Object.entries(CONSTITUTION_SECTION_MAP).map(([k, v]) => `${k}->${v}`).join(', ');
const wired =
  built.find((b) => b.id === 'identity').content === gen.sections.identity &&
  built.find((b) => b.id === 'system-rules').content === gen.sections.constraints &&
  built.find((b) => b.id === 'doing-tasks').content === gen.sections.scope &&
  built.find((b) => b.id === 'actions').content === gen.sections.escalation &&
  built.find((b) => b.id === 'output-style').content === renderedOutput &&
  built.filter((b) => ['identity', 'system-rules', 'doing-tasks', 'actions', 'output-style'].includes(b.id)).every((b) => b.content.length > 0) &&
  reg.size() === 10 &&
  bdesc.valid === true &&
  /^[0-9a-f]{64}$/.test(bdesc.cacheKey);
check(
  'P8 constitution wired into Scope A canonical registry (all 5 mapped) + Scope B boundary valid',
  wired,
  `map: ${mapping}; registry.size()=${reg.size()}; ` +
  `wired sections=${JSON.stringify(built.filter((b) => Object.values(CONSTITUTION_SECTION_MAP).includes(b.id)).map((b) => ({ id: b.id, kind: b.kind, chars: b.content.length })))}; ` +
  `boundary=${JSON.stringify(bdesc)}`
);

// --- Extra: error classes are Scope A's PromptError ---
const classOk = (() => {
  try {
    constitution.generate({});
    return false;
  } catch (err) {
    return err instanceof PromptError && isPromptError(err, 'E_MISSING_ROLE');
  }
})();
check(
  'E1 all constitution refusals reuse the Scope A PromptError class (single error vocabulary)',
  classOk,
  `generate({}) threw instanceof PromptError (imported from prompt/assembly/errors.js) = ${classOk}`
);

console.log('');
console.log(failures === 0 ? 'SCOPE C PROBE: ALL CHECKS PASS' : `SCOPE C PROBE: ${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);

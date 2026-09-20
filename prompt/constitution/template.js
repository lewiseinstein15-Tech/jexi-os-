// prompt/constitution/template.js
// Five-section constitutional template (Phase 25, Scope C).
//
// generate(spec) assembles the constitution from the four building
// blocks in this directory (constraints / scope / escalation /
// output-format). Generation order is: validate EVERYTHING first,
// then mutate shared registries (triggers, declared schema) — a
// failed generate() leaves no partial side effects.
//
// Determinism: no timestamps, no randomness, fixed key order —
// the same spec generates byte-identical output.

import { PromptError } from '../assembly/errors.js';
import {
  buildSection as buildConstraintsSection,
  assertConstraintItems,
  softWordMatches,
  hasAbsoluteNegation,
  ALLOWED_NEGATIONS,
} from './constraints.js';
import { buildSection as buildScopeSection, assertScope } from './scope.js';
import {
  renderSection as renderEscalationSection,
  registerNamedTriggers,
  assertTriggers,
  VAGUE_TRIGGER_PHRASES,
  TRIGGER_LINE_RE,
} from './escalation.js';
import {
  renderSection as renderOutputFormatSection,
  defaultSchemaFor,
  declare,
  assertValidSchema,
  SCHEMA_DIALECT,
} from './output-format.js';

export const SECTION_HEADERS = Object.freeze([
  '## 1. Identity & Role',
  '## 2. Behavioral Constraints',
  '## 3. Scope Limitations',
  '## 4. Escalation Triggers',
  '## 5. Output Format',
]);

/**
 * Constitution section -> canonical section id (Scope A order.js).
 * Shown wiring:
 *   identity     -> identity      (canonical 01, static)
 *   constraints  -> system-rules  (canonical 03, static)
 *   scope        -> doing-tasks   (canonical 04, static)
 *   escalation   -> actions       (canonical 05, static)
 *   outputFormat -> output-style  (canonical 02, static)
 * All five constitution sections are cache-stable, so all five map
 * into the STATIC block of the canonical assembly.
 */
export const CONSTITUTION_SECTION_MAP = Object.freeze({
  identity: 'identity',
  constraints: 'system-rules',
  scope: 'doing-tasks',
  escalation: 'actions',
  outputFormat: 'output-style',
});

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Spec contract (required fields are strict; "or similar" codes):
 *   id          non-empty string        -> E_MISSING_ID
 *   role        non-empty string        -> E_MISSING_ROLE
 *   constraints non-empty string array  -> E_MISSING_CONSTRAINTS
 *   scope       { validTopics: [...] }  -> E_MISSING_SCOPE / E_INVALID_SCOPE
 *   escalation  optional array of named triggers (built-ins used
 *               otherwise)              -> E_INVALID_ESCALATION
 *   outputSchema optional JSON Schema 2020-12 (default per agent id)
 *                                       -> E_INVALID_SCHEMA /
 *                                          E_UNSUPPORTED_KEYWORD /
 *                                          E_SCHEMA_DIALECT
 */
function assertSpec(spec) {
  if (!isPlainObject(spec)) {
    throw new PromptError('E_MISSING_ROLE', 'spec must be an object', { got: typeof spec });
  }
  if (typeof spec.role !== 'string' || spec.role.trim() === '') {
    throw new PromptError('E_MISSING_ROLE', 'spec.role must be a non-empty string', { got: spec.role === undefined ? 'undefined' : typeof spec.role });
  }
  if (typeof spec.id !== 'string' || spec.id.trim() === '') {
    throw new PromptError('E_MISSING_ID', 'spec.id must be a non-empty string', { got: spec.id === undefined ? 'undefined' : typeof spec.id });
  }
  if (!Array.isArray(spec.constraints)) {
    throw new PromptError('E_MISSING_CONSTRAINTS', 'spec.constraints must be a non-empty array of absolute constraint statements', { got: typeof spec.constraints });
  }
}

/**
 * constitution.generate(spec) -> { sections, rendered } (frozen)
 * Throws (pure-first, then side effects):
 *   E_MISSING_ROLE / E_MISSING_ID / E_MISSING_CONSTRAINTS /
 *   E_INVALID_CONSTRAINTS / E_SOFT_LANGUAGE / E_MISSING_SCOPE /
 *   E_INVALID_SCOPE / E_INVALID_ESCALATION / E_INVALID_SCHEMA /
 *   E_UNSUPPORTED_KEYWORD / E_SCHEMA_DIALECT
 */
export function generate(spec) {
  // 1) Pure validation pass — no side effects before this completes.
  assertSpec(spec);
  assertConstraintItems(spec.constraints);
  assertScope(spec.scope);
  if (spec.escalation !== undefined) assertTriggers(spec.escalation);
  const schema = spec.outputSchema !== undefined ? spec.outputSchema : defaultSchemaFor(spec.id);
  assertValidSchema(schema);

  // 2) Side effects: append-only trigger registration + schema declaration.
  if (spec.escalation !== undefined) registerNamedTriggers(spec.escalation);
  declare(spec.id, schema);

  // 3) Render.
  const identityLines = [`You are ${spec.role} (agent id: ${spec.id}).`];
  if (typeof spec.mission === 'string' && spec.mission.trim() !== '') identityLines.push(`Mission: ${spec.mission}`);
  if (typeof spec.persona === 'string' && spec.persona.trim() !== '') identityLines.push(`Persona: ${spec.persona}`);
  const identityBody = identityLines.join('\n');
  const constraintsBody = buildConstraintsSection(spec.constraints);
  const scopeBody = buildScopeSection(spec.scope);
  const escalationBody = renderEscalationSection();
  const outputFormatBody = renderOutputFormatSection(schema);

  const rendered = [
    `# Constitution: ${spec.role} (${spec.id})`,
    '',
    SECTION_HEADERS[0],
    identityBody,
    '',
    SECTION_HEADERS[1],
    constraintsBody,
    '',
    SECTION_HEADERS[2],
    scopeBody,
    '',
    SECTION_HEADERS[3],
    escalationBody,
    '',
    SECTION_HEADERS[4],
    outputFormatBody,
    '',
  ].join('\n');

  return Object.freeze({
    sections: Object.freeze({
      identity: identityBody,
      constraints: constraintsBody,
      scope: scopeBody,
      escalation: escalationBody,
      outputFormat: schema,
    }),
    rendered,
  });
}

/**
 * constitution.validate(constitution) -> { valid, violations }
 * Non-throwing audit of a generate() result. Violation codes:
 *   MALFORMED_CONSTITUTION, MISSING_SECTION, OUTPUT_FORMAT_SCHEMA,
 *   OUTPUT_FORMAT_DIALECT, RENDERED_MISMATCH, SOFT_LANGUAGE,
 *   NON_ABSOLUTE_CONSTRAINT, VAGUE_TRIGGER
 */
export function validate(constitution) {
  const violations = [];
  const push = (code, message, location) => violations.push(location ? { code, message, location } : { code, message });
  const c = constitution;

  if (!isPlainObject(c) || !isPlainObject(c.sections) || typeof c.rendered !== 'string') {
    push('MALFORMED_CONSTITUTION', 'constitution must be { sections: {identity, constraints, scope, escalation, outputFormat}, rendered: string }');
    return { valid: false, violations };
  }
  const s = c.sections;

  for (const key of ['identity', 'constraints', 'scope', 'escalation']) {
    if (typeof s[key] !== 'string' || s[key].trim() === '') {
      push('MISSING_SECTION', `sections.${key} must be a non-empty string`, `sections.${key}`);
    }
  }
  if (!isPlainObject(s.outputFormat)) {
    push('MISSING_SECTION', 'sections.outputFormat must be an object (JSON Schema)', 'sections.outputFormat');
  } else {
    if (s.outputFormat.$schema !== SCHEMA_DIALECT) {
      push('OUTPUT_FORMAT_DIALECT', `sections.outputFormat.$schema must be "${SCHEMA_DIALECT}"`, 'sections.outputFormat.$schema');
    }
    if (typeof s.outputFormat.type !== 'string' && !isPlainObject(s.outputFormat.properties)) {
      push('OUTPUT_FORMAT_SCHEMA', 'output schema must declare type or properties', 'sections.outputFormat');
    }
  }

  if (typeof c.rendered === 'string' && c.rendered.length > 0) {
    SECTION_HEADERS.forEach((h, i) => {
      if (!c.rendered.includes(h)) push('RENDERED_MISMATCH', `rendered is missing header "${h}"`, `rendered#${i + 1}`);
    });
    for (const key of ['identity', 'constraints', 'scope', 'escalation']) {
      if (typeof s[key] === 'string' && s[key] !== '' && !c.rendered.includes(s[key])) {
        push('RENDERED_MISMATCH', `rendered does not contain sections.${key} verbatim`, `rendered~${key}`);
      }
    }
  }

  if (typeof s.constraints === 'string' && s.constraints !== '') {
    for (const m of softWordMatches(s.constraints)) {
      push('SOFT_LANGUAGE', `forbidden soft word "${m.word}" (listed as "${m.listed}") in constraints`, 'sections.constraints');
    }
    for (const line of s.constraints.split('\n').filter((l) => l.startsWith('- '))) {
      if (!hasAbsoluteNegation(line)) {
        push('NON_ABSOLUTE_CONSTRAINT', `constraint line uses no allowed absolute negation (${ALLOWED_NEGATIONS.join(', ')}): "${line}"`, 'sections.constraints');
      }
    }
  }

  if (typeof s.escalation === 'string' && s.escalation !== '') {
    const triggerLines = s.escalation.split('\n').filter((l) => l.startsWith('- '));
    if (triggerLines.length === 0) {
      push('MISSING_SECTION', 'escalation section declares no named triggers', 'sections.escalation');
    }
    for (const line of triggerLines) {
      if (!TRIGGER_LINE_RE.test(line)) {
        push('VAGUE_TRIGGER', `escalation line is not a named trigger: "${line}"`, 'sections.escalation');
      }
    }
    const lower = s.escalation.toLowerCase();
    for (const phrase of VAGUE_TRIGGER_PHRASES) {
      if (lower.includes(phrase)) {
        push('VAGUE_TRIGGER', `vague phrase "${phrase}" in escalation section`, 'sections.escalation');
      }
    }
  }

  return { valid: violations.length === 0, violations };
}

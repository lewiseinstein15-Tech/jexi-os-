// prompt/constitution/index.js
// Public surface of the five-section constitutional template (Phase 25, Scope C).
//
// Contract spellings:
//   constitution.generate(spec)  -> { sections, rendered }
//   constitution.validate(c)     -> { valid, violations }
//   escalation.check(context)    -> { action, trigger, reason }
//   outputFormat.declare(agentId, schema)
//   outputFormat.validate(agentId, response) -> { valid, errors }

import * as template from './template.js';
import * as escalationModule from './escalation.js';
import * as outputFormatModule from './output-format.js';
import * as constraintsModule from './constraints.js';
import * as scopeModule from './scope.js';

export const constitution = Object.freeze({
  generate: template.generate,
  validate: template.validate,
  SECTION_HEADERS: template.SECTION_HEADERS,
  CONSTITUTION_SECTION_MAP: template.CONSTITUTION_SECTION_MAP,
});

export const escalation = Object.freeze({
  check: escalationModule.check,
  registerNamedTriggers: escalationModule.registerNamedTriggers,
  assertTriggers: escalationModule.assertTriggers,
  listTriggers: escalationModule.listTriggers,
  renderSection: escalationModule.renderSection,
  BUILT_IN_TRIGGERS: escalationModule.BUILT_IN_TRIGGERS,
  VAGUE_TRIGGER_PHRASES: escalationModule.VAGUE_TRIGGER_PHRASES,
  OUTCOMES: escalationModule.OUTCOMES,
});

export const outputFormat = Object.freeze({
  declare: outputFormatModule.declare,
  validate: outputFormatModule.validate,
  getSchema: outputFormatModule.getSchema,
  isDeclared: outputFormatModule.isDeclared,
  defaultSchemaFor: outputFormatModule.defaultSchemaFor,
  renderSection: outputFormatModule.renderSection,
  assertValidSchema: outputFormatModule.assertValidSchema,
  SCHEMA_DIALECT: outputFormatModule.SCHEMA_DIALECT,
  SUPPORTED_KEYWORDS: outputFormatModule.SUPPORTED_KEYWORDS,
  DEFAULT_SCHEMAS: outputFormatModule.DEFAULT_SCHEMAS,
});

export const constraints = Object.freeze({
  ALLOWED_NEGATIONS: constraintsModule.ALLOWED_NEGATIONS,
  FORBIDDEN_SOFT_WORDS: constraintsModule.FORBIDDEN_SOFT_WORDS,
  softWordMatches: constraintsModule.softWordMatches,
  hasAbsoluteNegation: constraintsModule.hasAbsoluteNegation,
});

export const scope = Object.freeze({
  DEFAULT_DECISION_BOUNDARIES: scopeModule.DEFAULT_DECISION_BOUNDARIES,
});

export const generate = template.generate;
export const validate = template.validate;
export const SECTION_HEADERS = template.SECTION_HEADERS;
export { CONSTITUTION_SECTION_MAP } from './template.js';
export const escalationCheck = escalationModule.check;
export const registerNamedTriggers = escalationModule.registerNamedTriggers;
export const declare = outputFormatModule.declare;
export const validateOutput = outputFormatModule.validate;
export const SCHEMA_DIALECT = outputFormatModule.SCHEMA_DIALECT;

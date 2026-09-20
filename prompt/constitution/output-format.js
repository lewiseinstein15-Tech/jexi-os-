// prompt/constitution/output-format.js
// Structured response schemas for the constitutional template (Phase 25, Scope C).
//
// Section 5 ("Output Format"). Dialect: JSON Schema DRAFT 2020-12
// (picked and documented here; $schema must equal SCHEMA_DIALECT).
//
// Strictness contract:
//   - declare() whitelists keywords: anything outside the supported
//     subset is refused (E_UNSUPPORTED_KEYWORD) — never silently
//     ignored, because silent ignoring hides broken schemas.
//   - validate() performs strict validation with NO coercion:
//     type checks use typeof semantics, "5" is not a number,
//     NaN is not a number.
//   - Errors are surfaced as a list of { path, keyword, message } —
//     never swallowed.
//
// Supported subset (documented contract): $schema, type, properties,
// required, additionalProperties (false only is enforced), items,
// enum, minLength, maxLength, minimum, maximum, minItems, maxItems,
// description, title. Composition keywords (anyOf/oneOf/allOf/not)
// are OUTSIDE the subset and refused at declare().

import { PromptError } from '../assembly/errors.js';

export const SCHEMA_DIALECT = 'https://json-schema.org/draft/2020-12/schema';

export const SUPPORTED_KEYWORDS = Object.freeze([
  '$schema', 'type', 'properties', 'required', 'additionalProperties', 'items',
  'enum', 'minLength', 'maxLength', 'minimum', 'maximum', 'minItems', 'maxItems',
  'description', 'title',
]);

const KNOWN_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'object', 'array', 'null']);

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Recursively validate a schema against the supported subset. Throws PromptError. */
export function assertValidSchema(schema, path = '#') {
  if (!isPlainObject(schema)) {
    throw new PromptError('E_INVALID_SCHEMA', `schema at ${path} must be an object`, { path, got: typeof schema });
  }
  for (const key of Object.keys(schema)) {
    if (!SUPPORTED_KEYWORDS.includes(key)) {
      throw new PromptError('E_UNSUPPORTED_KEYWORD', `schema keyword "${key}" at ${path} is outside the supported 2020-12 subset`, { path, keyword: key, supported: SUPPORTED_KEYWORDS });
    }
  }
  if (schema.$schema !== undefined && schema.$schema !== SCHEMA_DIALECT) {
    throw new PromptError('E_SCHEMA_DIALECT', `schema $schema at ${path} must be "${SCHEMA_DIALECT}"`, { path, got: String(schema.$schema) });
  }
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    for (const t of types) {
      if (!KNOWN_TYPES.has(t)) {
        throw new PromptError('E_INVALID_SCHEMA', `schema type "${t}" at ${path} is unknown`, { path, type: String(t) });
      }
    }
  }
  if (schema.required !== undefined && (!Array.isArray(schema.required) || !schema.required.every((r) => typeof r === 'string'))) {
    throw new PromptError('E_INVALID_SCHEMA', `schema required at ${path} must be an array of strings`, { path });
  }
  if (schema.enum !== undefined && (!Array.isArray(schema.enum) || schema.enum.length === 0)) {
    throw new PromptError('E_INVALID_SCHEMA', `schema enum at ${path} must be a non-empty array`, { path });
  }
  for (const k of ['minLength', 'maxLength', 'minimum', 'maximum', 'minItems', 'maxItems']) {
    if (schema[k] !== undefined && typeof schema[k] !== 'number') {
      throw new PromptError('E_INVALID_SCHEMA', `schema ${k} at ${path} must be a number`, { path });
    }
  }
  if (schema.properties !== undefined) {
    if (!isPlainObject(schema.properties)) {
      throw new PromptError('E_INVALID_SCHEMA', `schema properties at ${path} must be an object`, { path });
    }
    for (const [k, sub] of Object.entries(schema.properties)) assertValidSchema(sub, `${path}/${k}`);
  }
  if (schema.items !== undefined) assertValidSchema(schema.items, `${path}/items`);
  return schema;
}

// Default response schemas per agent type (frozen catalog; callers
// get a fresh structuredClone). Unknown agent ids fall back to
// 'generic' — Scope J (later) may extend this catalog.
export const DEFAULT_SCHEMAS = Object.freeze({
  researcher: Object.freeze({
    $schema: SCHEMA_DIALECT,
    title: 'researcher response',
    type: 'object',
    required: ['summary', 'findings', 'sources'],
    additionalProperties: false,
    properties: Object.freeze({
      summary: Object.freeze({ type: 'string', minLength: 1 }),
      findings: Object.freeze({ type: 'array', items: { type: 'string' } }),
      sources: Object.freeze({ type: 'array', items: { type: 'string' } }),
      confidence: Object.freeze({ type: 'number', minimum: 0, maximum: 1 }),
    }),
  }),
  generic: Object.freeze({
    $schema: SCHEMA_DIALECT,
    title: 'generic response',
    type: 'object',
    required: ['summary'],
    additionalProperties: false,
    properties: Object.freeze({
      summary: Object.freeze({ type: 'string', minLength: 1 }),
    }),
  }),
});

export function defaultSchemaFor(agentId) {
  return structuredClone(DEFAULT_SCHEMAS[agentId] ?? DEFAULT_SCHEMAS.generic);
}

// Declared schemas registry (agentId -> frozen structured clone).
const declared = new Map();

/**
 * declare(agentId, schema) — validate and store a response schema
 * for an agent. Refuses: malformed schema (E_INVALID_SCHEMA),
 * unsupported keywords (E_UNSUPPORTED_KEYWORD), wrong dialect
 * (E_SCHEMA_DIALECT). Re-declaring REPLACES the stored schema.
 */
export function declare(agentId, schema) {
  if (typeof agentId !== 'string' || agentId.trim() === '') {
    throw new PromptError('E_INVALID_SCHEMA', 'agentId must be a non-empty string', { got: typeof agentId });
  }
  assertValidSchema(schema);
  declared.set(agentId, Object.freeze(structuredClone(schema)));
  return { agentId, dialect: SCHEMA_DIALECT, declared: true };
}

export function getSchema(agentId) {
  return declared.get(agentId) ?? null;
}

export function isDeclared(agentId) {
  return declared.has(agentId);
}

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function checkType(t, v) {
  switch (t) {
    case 'string': return typeof v === 'string';
    case 'number': return typeof v === 'number' && Number.isFinite(v);
    case 'integer': return typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v);
    case 'boolean': return typeof v === 'boolean';
    case 'object': return isPlainObject(v);
    case 'array': return Array.isArray(v);
    case 'null': return v === null;
    default: return false;
  }
}

function validateAgainst(schema, value, path, errors) {
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => checkType(t, value))) {
      errors.push({ path, keyword: 'type', message: `expected type ${types.join(' | ')}, got ${typeOf(value)} (strict — no coercion)` });
      return;
    }
  }
  if (schema.enum !== undefined && !schema.enum.some((v) => v === value)) {
    errors.push({ path, keyword: 'enum', message: `value not in enum [${schema.enum.map((v) => JSON.stringify(v)).join(', ')}]` });
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push({ path, keyword: 'minLength', message: `length ${value.length} < minLength ${schema.minLength}` });
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push({ path, keyword: 'maxLength', message: `length ${value.length} > maxLength ${schema.maxLength}` });
    }
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push({ path, keyword: 'minimum', message: `${value} < minimum ${schema.minimum}` });
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push({ path, keyword: 'maximum', message: `${value} > maximum ${schema.maximum}` });
    }
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push({ path, keyword: 'minItems', message: `${value.length} items < minItems ${schema.minItems}` });
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push({ path, keyword: 'maxItems', message: `${value.length} items > maxItems ${schema.maxItems}` });
    }
    if (schema.items) value.forEach((v, i) => validateAgainst(schema.items, v, `${path}/${i}`, errors));
  }
  if (isPlainObject(value)) {
    for (const req of schema.required ?? []) {
      if (!(req in value)) errors.push({ path, keyword: 'required', message: `missing required property "${req}"` });
    }
    for (const [k, sub] of Object.entries(schema.properties ?? {})) {
      if (k in value) validateAgainst(sub, value[k], `${path}/${k}`, errors);
    }
    if (schema.additionalProperties === false) {
      const props = schema.properties ?? {};
      for (const k of Object.keys(value)) {
        if (!(k in props)) errors.push({ path, keyword: 'additionalProperties', message: `unexpected property "${k}" (additionalProperties: false)` });
      }
    }
  }
}

/**
 * validate(agentId, response) -> { valid, errors }
 * Throws E_UNDECLARED_AGENT when no schema was declared for agentId
 * (a missing schema is a programming error, not a validation miss).
 */
export function validate(agentId, response) {
  const schema = declared.get(agentId);
  if (!schema) {
    throw new PromptError('E_UNDECLARED_AGENT', `no output schema declared for agent "${agentId}" — declare() first`, { agentId });
  }
  const errors = [];
  validateAgainst(schema, response, '#', errors);
  return { valid: errors.length === 0, errors };
}

/** Render section-5 body for a validated schema. */
export function renderSection(schema) {
  assertValidSchema(schema);
  return [
    'The response MUST match the JSON Schema below (draft 2020-12, strict — no coercion); failing responses are refused and their errors surfaced.',
    '',
    '```json',
    JSON.stringify(schema, null, 2),
    '```',
  ].join('\n');
}

/**
 * JEXI OS — PHASE 13 SCOPE A — CANONICAL AGENT SPEC.
 *
 * An agent is a SPEC, not a blob. The spec is the roster row: who the agent is
 * (id, name), where it sits (division), what it can do (capabilities[]), how
 * much it is trusted (trustLevel), and where it came from (origin). Prose
 * bodies live with their source; the roster keeps the machine-usable contract.
 *
 *   import { validate, SPEC_VERSION, REQUIRED_FIELDS } from './agent-spec.js';
 *
 * Validation is pure and returns every error, not the first: a roster of 400+
 * agents is reconciled in bulk, and a loader that stops at error #1 turns one
 * bad file into an unreadable roster.
 */

/** Spec schema version. Bumped only when the row shape changes. */
export const SPEC_VERSION = 1;

/** Fields every spec must carry. `capabilities` may be empty, not absent. */
export const REQUIRED_FIELDS = ['id', 'name', 'division', 'role', 'capabilities', 'trustLevel', 'origin'];

/** Trust tiers a roster row may start at. Nothing here has been verified yet. */
export const TRUST_LEVELS = ['provisional', 'trusted', 'restricted', 'untrusted'];

/**
 * Capability vocabulary for the roster. Distinct from the Director's hot-path
 * vocabulary in server/src/services/director/Employees.js (12 tokens, tuned for
 * live dispatch): the roster spans 18 divisions, so it needs the wider set.
 */
export const CAPABILITIES = [
  'analytics', 'automation', 'code', 'compliance', 'computer', 'data',
  'design', 'finance', 'infrastructure', 'integration', 'language',
  'marketing', 'media', 'memory', 'planning', 'product', 'reasoning',
  'research', 'search', 'security', 'support', 'synthesis', 'teaching',
  'verification',
];

const CAP_SET = new Set(CAPABILITIES);
const TRUST_SET = new Set(TRUST_LEVELS);

/** Error codes this module can emit. */
export const ERRORS = {
  MISSING_FIELD: 'E_MISSING_FIELD',
  UNKNOWN_DIVISION: 'E_UNKNOWN_DIVISION',
  UNKNOWN_AGENT: 'E_UNKNOWN_AGENT',
  DUPLICATE_AGENT: 'E_DUPLICATE_AGENT',
  INVALID_CAPABILITY: 'E_INVALID_CAPABILITY',
  INVALID_TRUST_LEVEL: 'E_INVALID_TRUST_LEVEL',
  INVALID_SPEC: 'E_INVALID_SPEC',
};

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function isBlank(v) {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

/**
 * Validate one spec against the schema.
 *
 *   validate(spec)                          -> { valid, errors? }
 *   validate(spec, { divisions: ['ops'] })  -> also checks division membership
 *
 * Errors are `{ code, field, message }`; `code` is stable, `message` is for
 * humans. An absent required field reports `E_MISSING_FIELD` naming the field,
 * which is what the loader surfaces per file.
 */
export function validate(spec, options = {}) {
  const errors = [];
  if (!isPlainObject(spec)) {
    return { valid: false, errors: [{ code: ERRORS.INVALID_SPEC, field: null, message: 'spec must be an object' }] };
  }

  for (const field of REQUIRED_FIELDS) {
    if (!(field in spec)) {
      errors.push({ code: ERRORS.MISSING_FIELD, field, message: `missing required field "${field}"` });
    }
  }
  if (errors.some((e) => e.code === ERRORS.MISSING_FIELD)) {
    return { valid: false, errors };
  }

  for (const field of ['id', 'name', 'division', 'role', 'origin']) {
    if (isBlank(spec[field])) {
      errors.push({ code: ERRORS.MISSING_FIELD, field, message: `field "${field}" must be a non-empty string` });
    }
  }

  if (!Array.isArray(spec.capabilities)) {
    errors.push({ code: ERRORS.INVALID_SPEC, field: 'capabilities', message: 'capabilities must be an array' });
  } else {
    for (const cap of spec.capabilities) {
      if (!CAP_SET.has(cap)) {
        errors.push({ code: ERRORS.INVALID_CAPABILITY, field: 'capabilities', message: `unknown capability "${cap}"` });
      }
    }
    if (new Set(spec.capabilities).size !== spec.capabilities.length) {
      errors.push({ code: ERRORS.INVALID_SPEC, field: 'capabilities', message: 'capabilities must not repeat' });
    }
  }

  if (!TRUST_SET.has(spec.trustLevel)) {
    errors.push({ code: ERRORS.INVALID_TRUST_LEVEL, field: 'trustLevel', message: `unknown trust level "${spec.trustLevel}"` });
  }

  const divisions = options.divisions;
  if (Array.isArray(divisions) && divisions.length > 0 && !isBlank(spec.division) && !divisions.includes(spec.division)) {
    errors.push({ code: ERRORS.UNKNOWN_DIVISION, field: 'division', message: `unknown division "${spec.division}"` });
  }

  return errors.length ? { valid: false, errors } : { valid: true };
}

/** True when `spec` passes `validate` with the same options. */
export function isValid(spec, options) {
  return validate(spec, options).valid;
}

/** Build a spec with defaults applied. Throws `SpecError` on an invalid result. */
export function makeSpec(input, options = {}) {
  const spec = {
    specVersion: SPEC_VERSION,
    id: input.id,
    name: input.name,
    division: input.division,
    role: input.role,
    description: input.description || '',
    capabilities: Array.isArray(input.capabilities) ? [...input.capabilities] : [],
    trustLevel: input.trustLevel || 'provisional',
    origin: input.origin,
    sourcePath: input.sourcePath || null,
    tools: Array.isArray(input.tools) ? [...input.tools] : [],
  };
  const { valid, errors } = validate(spec, options);
  if (!valid) throw new SpecError(spec.id, errors);
  return spec;
}

/**
 * Thrown by `makeSpec` when a row does not satisfy the schema. Carries the
 * per-field error list so a caller (the loader) can report every problem with
 * one row instead of parsing the message back out.
 */
export class SpecError extends Error {
  constructor(id, errors = []) {
    const detail = errors.map((e) => (e.field ? `${e.code}:${e.field}` : e.code)).join(', ');
    super(`invalid agent spec "${id}": ${detail || 'unknown error'}`);
    this.name = 'SpecError';
    this.agentId = id;
    this.errors = errors;
  }
}
/**
 * JEXI OS — PHASE 13 SCOPE B — DIVISION SPEC.
 *
 * A division groups agents by function. The committed source of truth is
 * workforce/divisions.json (Phase 7 J, generated from the agents/ tree); this
 * module normalizes one of its entries into the roster-facing spec and
 * validates it.
 *
 * The file's own vocabulary is display-oriented:
 *
 *   { id, label, icon, color, description, agentCount, template? }
 *
 * The roster vocabulary is behavioural:
 *
 *   { id, name, purpose, icon, color, agentCount, template, capabilities[] }
 *
 * `normalize` maps one to the other (label -> name, description -> purpose) and
 * keeps icon/color for the UI. `capabilities[]` is NOT in the file — it is the
 * union of the division's members' capabilities, computed by the registry once
 * the roster is known. A division with no members has an empty capability set.
 *
 *   import { normalize, validate, ERRORS } from './division.js';
 *
 * Validation is pure and returns every error, matching agent-spec.js, so a
 * drifted divisions.json reports all its problems in one pass.
 */

/** Schema version. Bumped only when the division shape changes. */
export const DIVISION_VERSION = 1;

/** Fields every normalized division must carry. `capabilities` may be empty. */
export const REQUIRED_FIELDS = ['id', 'name', 'purpose', 'capabilities'];

/** Error codes this module and the registry can emit. */
export const ERRORS = {
  UNKNOWN_DIVISION: 'E_UNKNOWN_DIVISION',
  UNKNOWN_AGENT: 'E_UNKNOWN_AGENT',
  MISSING_FIELD: 'E_MISSING_FIELD',
  INVALID_DIVISION: 'E_INVALID_DIVISION',
  NO_MEMBERSHIP: 'E_NO_MEMBERSHIP',
};

/**
 * Refusal raised by divisions.get / members / assign / unassign. Carries the
 * stable `code` the caller switches on, so a refusal is never a bare string.
 */
export class DivisionError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'DivisionError';
    this.code = code;
    Object.assign(this, detail);
  }
}

function isBlank(v) {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

/**
 * Normalize one entry from workforce/divisions.json into a division spec.
 *
 *   normalize(raw) -> { id, name, purpose, icon, color, declaredAgentCount,
 *                       template, capabilities[], source }
 *
 * Missing optional display fields are tolerated (null); missing identity fields
 * are left blank for `validate` to report rather than invented here.
 */
export function normalize(raw = {}) {
  return {
    divisionVersion: DIVISION_VERSION,
    id: isBlank(raw.id) ? null : String(raw.id),
    name: isBlank(raw.label) ? (isBlank(raw.name) ? null : String(raw.name)) : String(raw.label),
    purpose: isBlank(raw.description) ? (isBlank(raw.purpose) ? null : String(raw.purpose)) : String(raw.description),
    icon: raw.icon || null,
    color: raw.color || null,
    declaredAgentCount: Number.isFinite(raw.agentCount) ? raw.agentCount : null,
    template: raw.template === true,
    capabilities: Array.isArray(raw.capabilities) ? [...raw.capabilities].sort() : [],
    source: raw.source || 'workforce/divisions.json',
  };
}

/**
 * Validate a normalized division.
 *
 *   validate(division) -> { valid, errors? }
 *
 * Errors are `{ code, field, message }`, matching agent-spec.js.
 */
export function validate(division) {
  const errors = [];
  if (!division || typeof division !== 'object' || Array.isArray(division)) {
    return { valid: false, errors: [{ code: ERRORS.INVALID_DIVISION, field: null, message: 'division must be an object' }] };
  }
  for (const field of REQUIRED_FIELDS) {
    if (!(field in division)) {
      errors.push({ code: ERRORS.MISSING_FIELD, field, message: `missing required field "${field}"` });
    }
  }
  if (errors.length) return { valid: false, errors };

  for (const field of ['id', 'name', 'purpose']) {
    if (isBlank(division[field])) {
      errors.push({ code: ERRORS.MISSING_FIELD, field, message: `field "${field}" must be a non-empty string` });
    }
  }
  if (!Array.isArray(division.capabilities)) {
    errors.push({ code: ERRORS.INVALID_DIVISION, field: 'capabilities', message: 'capabilities must be an array' });
  }
  return errors.length ? { valid: false, errors } : { valid: true };
}

/** True when `division` passes `validate`. */
export function isValid(division) {
  return validate(division).valid;
}

/**
 * The minimal record a division needs to answer a membership query, without
 * its derived capability union.
 */
export function identity(division) {
  return { id: division.id, name: division.name, purpose: division.purpose };
}
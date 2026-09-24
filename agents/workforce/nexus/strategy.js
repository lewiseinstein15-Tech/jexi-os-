/**
 * JEXI OS — PHASE 13 SCOPE C — NEXUS STRATEGY SPEC.
 *
 * A NEXUS strategy is a routing decision table: for an intent of a given kind,
 * which agent candidates does the doctrine name, and why. Strategies come from
 * the vendored projection of the upstream strategy tree (see vendor/README.md);
 * this module is the schema, validation, and normalization for one row.
 *
 *   import { normalize, validate, ERRORS, StrategyError } from './strategy.js';
 *
 * A strategy row carries upstream references verbatim (`candidates[]` are
 * display names or slugs). Resolving those to roster agents is orchestration's
 * job, because it needs Scope A. This module never touches the roster.
 *
 * Validation is pure and returns every error, matching Scope A's agent-spec.js
 * and Scope B's division.js, so a drifted projection reports all its problems
 * in one pass.
 */

/** Schema version. Bumped only when the strategy row shape changes. */
export const STRATEGY_VERSION = 1;

/**
 * Scopes a strategy can have. Determines how candidates are interpreted:
 *   phase    — a pipeline stage; candidates are the agents active in it
 *   task     — a task type; candidates are primary, QA, then specialists
 *   scenario — a runbook; candidates are the deployable roster
 */
export const SCOPES = ['phase', 'task', 'scenario'];

/** Fields every strategy must carry. */
export const REQUIRED_FIELDS = ['id', 'name', 'kind', 'aliases', 'scope', 'candidates'];

/** Error codes the nexus layer can emit. */
export const ERRORS = {
  NO_STRATEGY: 'E_NO_STRATEGY',
  NO_AGENT: 'E_NO_AGENT',
  UNKNOWN_STRATEGY: 'E_UNKNOWN_STRATEGY',
  UNKNOWN_DIVISION: 'E_UNKNOWN_DIVISION',
  INVALID_INTENT: 'E_INVALID_INTENT',
  INVALID_STRATEGY: 'E_INVALID_STRATEGY',
  AMBIGUOUS_AGENT: 'E_AMBIGUOUS_AGENT',
};

/**
 * Refusal raised by the nexus layer. Carries the stable `code` a caller
 * switches on, so a refusal is never a bare string or a silent fallback.
 */
export class StrategyError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'StrategyError';
    this.code = code;
    Object.assign(this, detail);
  }
}

function isBlank(v) {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

/**
 * Normalize one projected row into a strategy spec. Missing optional fields are
 * tolerated (null / []); missing identity fields are left blank for `validate`
 * to report rather than invented here.
 */
export function normalize(raw = {}) {
  return {
    strategyVersion: STRATEGY_VERSION,
    id: isBlank(raw.id) ? null : String(raw.id),
    name: isBlank(raw.name) ? null : String(raw.name),
    kind: isBlank(raw.kind) ? null : String(raw.kind),
    aliases: Array.isArray(raw.aliases) ? [...raw.aliases].sort() : [],
    scope: isBlank(raw.scope) ? null : String(raw.scope),
    mode: raw.mode || null,
    phase: Number.isFinite(raw.phase) ? raw.phase : null,
    taskType: raw.taskType || null,
    duration: raw.duration || null,
    summary: raw.summary || null,
    candidates: Array.isArray(raw.candidates) ? [...raw.candidates] : [],
    roles: raw.roles && typeof raw.roles === 'object' ? { ...raw.roles } : {},
    groups: Array.isArray(raw.groups) ? raw.groups.map((g) => ({ ...g })) : [],
    primary: raw.primary || null,
    qa: raw.qa || null,
    doc: raw.doc || null,
    playbook: raw.playbook || null,
    playbookMeta: raw.playbookMeta ? { ...raw.playbookMeta } : null,
    note: raw.note || null,
  };
}

/**
 * Validate a normalized strategy.
 *
 *   validate(strategy) -> { valid, errors? }
 *
 * Errors are `{ code, field, message }`, matching agent-spec.js and division.js.
 */
export function validate(strategy) {
  const errors = [];
  if (!strategy || typeof strategy !== 'object' || Array.isArray(strategy)) {
    return { valid: false, errors: [{ code: ERRORS.INVALID_STRATEGY, field: null, message: 'strategy must be an object' }] };
  }
  for (const field of REQUIRED_FIELDS) {
    if (!(field in strategy)) {
      errors.push({ code: ERRORS.INVALID_STRATEGY, field, message: `missing required field "${field}"` });
    }
  }
  if (errors.length) return { valid: false, errors };

  for (const field of ['id', 'name', 'kind', 'scope']) {
    if (isBlank(strategy[field])) {
      errors.push({ code: ERRORS.INVALID_STRATEGY, field, message: `field "${field}" must be a non-empty string` });
    }
  }
  if (!Array.isArray(strategy.aliases)) {
    errors.push({ code: ERRORS.INVALID_STRATEGY, field: 'aliases', message: 'aliases must be an array' });
  }
  if (!Array.isArray(strategy.candidates)) {
    errors.push({ code: ERRORS.INVALID_STRATEGY, field: 'candidates', message: 'candidates must be an array' });
  }
  if (strategy.scope && !SCOPES.includes(strategy.scope)) {
    errors.push({ code: ERRORS.INVALID_STRATEGY, field: 'scope', message: `unknown scope "${strategy.scope}"` });
  }
  return errors.length ? { valid: false, errors } : { valid: true };
}

/** True when `strategy` passes `validate`. */
export function isValid(strategy) {
  return validate(strategy).valid;
}

/** Every routing token a strategy answers to: its kind plus its aliases. */
export function tokens(strategy) {
  return [strategy.kind, ...(strategy.aliases || [])].filter(Boolean);
}

/** The token that canonically identifies a strategy, preferring kind. */
export function canonicalToken(strategy) {
  return strategy.kind || strategy.id;
}

export { STRATEGY_VERSION as default };
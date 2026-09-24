/** JEXI OS — Phase 30 Scope C — additive Phase 13 subagent contract. */
import { validate as validatePhase13 } from '../../../agents/workforce/agents/agent-spec.js';
import { scoping } from '../skills/index.js';

export const PERMISSION_MODES = Object.freeze(['default', 'acceptEdits', 'plan']);
export const ISOLATION_MODES = Object.freeze(['none', 'worktree']);
export const MEMORY_MODES = Object.freeze(['none', 'project', 'user', 'local']);

export const DEFAULTS = Object.freeze({
  allowedTools: Object.freeze([]),
  maxTurns: 10,
  permissionMode: 'default',
  isolation: 'none',
  background: false,
  memory: 'none',
  skills: Object.freeze([]),
});

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function copyArray(value) {
  return Array.isArray(value) ? [...value] : value;
}

/** Apply only additive defaults; every Phase 13 field is preserved. */
export function extendSpec(spec) {
  const source = isPlainObject(spec) ? spec : {};
  const {
    allowedTools = DEFAULTS.allowedTools,
    maxTurns = DEFAULTS.maxTurns,
    permissionMode = DEFAULTS.permissionMode,
    isolation = DEFAULTS.isolation,
    background = DEFAULTS.background,
    memory = DEFAULTS.memory,
    skills = DEFAULTS.skills,
    ...phase13
  } = source;
  return {
    ...phase13,
    allowedTools: copyArray(allowedTools),
    maxTurns,
    permissionMode,
    isolation,
    background,
    memory,
    skills: copyArray(skills),
  };
}

function arrayErrors(value, field, { patterns = false } = {}) {
  const errors = [];
  if (!Array.isArray(value)) {
    return [{ code: 'E_INVALID_SPEC', field, message: `${field} must be an array of non-empty strings` }];
  }
  for (const [index, item] of value.entries()) {
    if (typeof item !== 'string' || item.trim() === '') {
      errors.push({ code: 'E_INVALID_SPEC', field, message: `${field}[${index}] must be a non-empty string` });
      continue;
    }
    if (patterns) {
      try {
        scoping.parse(item);
      } catch (error) {
        errors.push({ code: error.code ?? 'E_INVALID_PATTERN', field, message: error.message });
      }
    }
  }
  if (new Set(value).size !== value.length) {
    errors.push({ code: 'E_INVALID_SPEC', field, message: `${field} must not repeat` });
  }
  return errors;
}

/** Validate the Phase 13 schema plus all additive subagent fields. */
export function validate(spec) {
  if (!isPlainObject(spec)) return validatePhase13(spec);
  const extended = extendSpec(spec);
  const base = validatePhase13(extended);
  const errors = [...(base.errors ?? [])];

  errors.push(...arrayErrors(extended.allowedTools, 'allowedTools', { patterns: true }));
  if (!Number.isInteger(extended.maxTurns) || extended.maxTurns <= 0) {
    errors.push({ code: 'E_INVALID_SPEC', field: 'maxTurns', message: 'maxTurns must be a positive integer' });
  }
  if (!PERMISSION_MODES.includes(extended.permissionMode)) {
    errors.push({
      code: 'E_INVALID_SPEC',
      field: 'permissionMode',
      message: `permissionMode must be one of ${PERMISSION_MODES.join(', ')}`,
    });
  }
  if (!ISOLATION_MODES.includes(extended.isolation)) {
    errors.push({ code: 'E_INVALID_SPEC', field: 'isolation', message: `isolation must be one of ${ISOLATION_MODES.join(', ')}` });
  }
  if (typeof extended.background !== 'boolean') {
    errors.push({ code: 'E_INVALID_SPEC', field: 'background', message: 'background must be boolean' });
  }
  if (!MEMORY_MODES.includes(extended.memory)) {
    errors.push({ code: 'E_INVALID_SPEC', field: 'memory', message: `memory must be one of ${MEMORY_MODES.join(', ')}` });
  }
  errors.push(...arrayErrors(extended.skills, 'skills'));

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

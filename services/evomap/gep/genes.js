/**
 * JEXI OS — Phase 15 Scope D — gene definitions.
 *
 * A gene carries a value and a schema. Schemas support number
 * (min/max), string (minLength/maxLength/pattern) and boolean.
 * Mutation results are validated against the schema; anything else
 * -> E_SCHEMA_VIOLATION.
 */
import { fail, assertNonEmptyString } from '../../semantica/_internal.js';

const TYPES = ['number', 'string', 'boolean'];

export function assertSchema(schema, what = 'schema') {
  if (!schema || typeof schema !== 'object' || !TYPES.includes(schema.type)) {
    throw fail('E_INVALID_SCHEMA', what + ' must declare type in (' + TYPES.join(', ') + ')');
  }
  if (schema.type === 'number' && schema.min !== undefined && schema.max !== undefined && schema.min > schema.max) {
    throw fail('E_INVALID_SCHEMA', what + ' min > max');
  }
  return schema;
}

export function validate(schema, value) {
  assertSchema(schema);
  if (schema.type === 'number') {
    if (typeof value !== 'number' || Number.isNaN(value)) return { ok: false, why: 'value is not a number' };
    if (schema.min !== undefined && value < schema.min) return { ok: false, why: 'value ' + value + ' < min ' + schema.min };
    if (schema.max !== undefined && value > schema.max) return { ok: false, why: 'value ' + value + ' > max ' + schema.max };
    return { ok: true };
  }
  if (schema.type === 'string') {
    if (typeof value !== 'string') return { ok: false, why: 'value is not a string' };
    if (schema.minLength !== undefined && value.length < schema.minLength) return { ok: false, why: 'length ' + value.length + ' < minLength ' + schema.minLength };
    if (schema.maxLength !== undefined && value.length > schema.maxLength) return { ok: false, why: 'length ' + value.length + ' > maxLength ' + schema.maxLength };
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) return { ok: false, why: 'value fails pattern ' + schema.pattern };
    return { ok: true };
  }
  if (typeof value !== 'boolean') return { ok: false, why: 'value is not a boolean' };
  return { ok: true };
}

export function makeGene({ id, name, value, schema }) {
  assertNonEmptyString(id, 'gene id', 'E_INVALID_GENE');
  assertNonEmptyString(name, 'gene name', 'E_INVALID_GENE');
  assertSchema(schema, 'gene ' + id + ' schema');
  const v = validate(schema, value);
  if (!v.ok) {
    throw fail('E_SCHEMA_VIOLATION', 'gene ' + id + ' initial value invalid: ' + v.why);
  }
  return { id, name, value, schema, version: 1 };
}

/** delta = { set: v } or { add: n } (numbers only). */
export function applyDelta(value, delta) {
  if (!delta || typeof delta !== 'object' || Array.isArray(delta)) {
    throw fail('E_INVALID_DELTA', 'delta must be { set } or { add }');
  }
  if ('set' in delta) return delta.set;
  if ('add' in delta) {
    if (typeof value !== 'number' || typeof delta.add !== 'number') {
      throw fail('E_INVALID_DELTA', 'add delta requires a numeric gene value');
    }
    return value + delta.add;
  }
  throw fail('E_INVALID_DELTA', 'delta must carry set or add');
}

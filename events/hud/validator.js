/**
 * JEXI OS — HUD STATUS CONTRACT — validator (Phase 7 F).
 *
 * One validator for the whole contract. The producer runs it BEFORE any
 * payload is published (a payload that fails validation is never served,
 * never pushed — probe P10), and every consumer side runs it again on
 * arrival (a payload that fails validation is refused, not rendered).
 *
 * Strictness contract:
 *   - the 5 identity keys are REQUIRED (version is pin-matched to
 *     jexi.hud-status.v1 — missing or wrong version is a hard error);
 *   - the 10 state sections are validated WHEN PRESENT; the producer
 *     normally always emits all of them, and the omission path is the
 *     explicit debug/probe seam (JEXI_HUD_OMIT) — panels then show
 *     "no data" instead of fabricating (probe P7);
 *   - unknown top-level keys are warnings, not errors (forward-compat).
 */

import { HUD_SCHEMA, HUD_VERSION, IDENTITY_KEYS, SECTION_KEYS, TOP_LEVEL_KEYS } from './schema.js';

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

function checkField(name, spec, value, errors, warnings) {
  const where = (msg) => errors.push(`${name}: ${msg}`);
  switch (spec.kind) {
    case 'const':
      if (value !== spec.value) where(`must be "${spec.value}" (got ${value === undefined ? 'undefined' : JSON.stringify(value)})`);
      break;
    case 'string':
      if (typeof value !== 'string' || !value.length) where('must be a non-empty string');
      break;
    case 'text':
      if (typeof value !== 'string') where('must be a string');
      break;
    case 'string|null':
      if (value !== null && (typeof value !== 'string' || !value.length)) where('must be a non-empty string or null');
      break;
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) { where('must be a finite number'); break; }
      if (spec.min != null && value < spec.min) where(`must be >= ${spec.min}`);
      if (spec.max != null && value > spec.max) where(`must be <= ${spec.max}`);
      break;
    }
    case 'boolean':
      if (typeof value !== 'boolean') where('must be a boolean');
      break;
    case 'iso':
      if (typeof value !== 'string' || !ISO_RE.test(value)) where('must be an ISO-8601 UTC timestamp (…Z)');
      break;
    case 'iso|null':
      if (value !== null && (typeof value !== 'string' || !ISO_RE.test(value))) where('must be an ISO-8601 UTC timestamp or null');
      break;
    case 'enum':
      if (!spec.values.includes(value)) where(`must be one of [${spec.values.join(', ')}] (got ${JSON.stringify(value)})`);
      break;
    case 'array': {
      if (!Array.isArray(value)) { where('must be an array'); break; }
      const item = spec.item || {};
      value.forEach((row, i) => {
        for (const [k, f] of Object.entries(item)) {
          if (f.kind === 'string|null' && row[k] === undefined) continue; // absent == null for optional-object fields
          checkField(`${name}[${i}].${k}`, f, row[k], errors, warnings);
        }
      });
      break;
    }
    default:
      warnings.push(`${name}: unknown kind "${spec.kind}" — field not enforced`);
  }
}

function checkObject(name, spec, value, errors, warnings) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    errors.push(`${name}: must be an object`);
    return;
  }
  for (const [k, f] of Object.entries(spec.fields || {})) {
    if (value[k] === undefined) continue; // absent optional field — P7 omission path
    checkField(`${name}.${k}`, f, value[k], errors, warnings);
  }
}

/**
 * Validate a HUD payload against jexi.hud-status.v1.
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validateHud(payload) {
  const errors = [];
  const warnings = [];
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { valid: false, errors: ['payload: must be an object'], warnings };
  }

  // 1. identity keys — REQUIRED (this is what makes P10 a hard fail)
  for (const key of IDENTITY_KEYS) {
    const spec = HUD_SCHEMA[key];
    if (payload[key] === undefined) {
      errors.push(`${key}: required by ${HUD_VERSION} but missing`);
      continue;
    }
    checkField(key, spec, payload[key], errors, warnings);
  }

  // 2. state sections — validated when present
  for (const key of SECTION_KEYS) {
    const spec = HUD_SCHEMA[key];
    if (payload[key] === undefined) continue;
    if (spec.kind === 'object') checkObject(key, spec, payload[key], errors, warnings);
    else checkField(key, spec, payload[key], errors, warnings);
  }

  // 3. unknown top-level keys — forward-compat warnings
  for (const key of Object.keys(payload)) {
    if (!TOP_LEVEL_KEYS.includes(key)) warnings.push(`${key}: not part of ${HUD_VERSION} — ignored by conforming consumers`);
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Consumer-side refusal: returns the payload only if it validates AND the
 * version key matches the contract pin exactly. Anything else throws —
 * the console renders nothing from a refused payload (probe P10).
 */
export function acceptHudOrThrow(payload) {
  const v = validateHud(payload);
  if (!v.valid) {
    const err = new Error(`HUD payload refused: ${v.errors.join('; ')}`);
    err.code = 'HUD_REFUSED';
    err.errors = v.errors;
    throw err;
  }
  if (payload.version !== HUD_VERSION) {
    const err = new Error(`HUD payload refused: version "${payload.version}" != "${HUD_VERSION}"`);
    err.code = 'HUD_REFUSED';
    throw err;
  }
  return payload;
}

/** True when every top-level key the contract defines is present. */
export function isCompleteHud(payload) {
  if (!payload || typeof payload !== 'object') return false;
  return TOP_LEVEL_KEYS.every((k) => payload[k] !== undefined);
}

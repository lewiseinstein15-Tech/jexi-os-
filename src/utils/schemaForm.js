/**
 * B141 — SCHEMA FORM (DeepSeek Harness `packages/client/schema-form` mirror,
 * JEXI-branded).
 *
 * Validate form values against a JSON-schema-ish spec: { fields: { name:
 * { type, required, min, max, options? } } }. Returns per-field errors +
 * a valid flag. Pure, no UI.
 *
 *   validateForm(values, spec) → { valid, errors: { field: message } }
 */

const TYPES = ['string', 'number', 'boolean'];

export function validateForm(values, spec) {
  const errors = {};
  const fields = (spec && spec.fields) || {};
  for (const [key, def] of Object.entries(fields)) {
    const value = values ? values[key] : undefined;
    if (def.required && (value === undefined || value === null || value === '')) {
      errors[key] = def.label ? `${def.label} is required` : `${key} is required`;
      continue;
    }
    if (value === undefined || value === null || value === '') continue;
    const type = def.type || 'string';
    if (TYPES.includes(type) && typeof value !== type) {
      errors[key] = `${def.label || key} must be a ${type}`;
      continue;
    }
    if (type === 'number') {
      const num = Number(value);
      if (Number.isNaN(num)) { errors[key] = `${def.label || key} must be a number`; continue; }
      if (def.min !== undefined && num < def.min) { errors[key] = `${def.label || key} must be at least ${def.min}`; continue; }
      if (def.max !== undefined && num > def.max) { errors[key] = `${def.label || key} must be at most ${def.max}`; continue; }
    }
    if (type === 'string' && def.minLength !== undefined && String(value).length < def.minLength) {
      errors[key] = `${def.label || key} must be at least ${def.minLength} characters`;
    }
    if (def.options && Array.isArray(def.options) && !def.options.includes(value)) {
      errors[key] = `${def.label || key} must be one of: ${def.options.join(', ')}`;
    }
  }
  return { valid: Object.keys(errors).length === 0, errors };
}

/** Coerce form strings to the spec's types (number/boolean). */
export function coerceFormValues(values, spec) {
  const out = { ...(values || {}) };
  const fields = (spec && spec.fields) || {};
  for (const [key, def] of Object.entries(fields)) {
    const value = out[key];
    if (value === undefined || value === null || value === '') continue;
    if (def.type === 'number') { const n = Number(value); if (!Number.isNaN(n)) out[key] = n; }
    else if (def.type === 'boolean') out[key] = value === true || value === 'true' || value === '1' || value === 'on';
  }
  return out;
}

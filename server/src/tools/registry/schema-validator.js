/**
 * JEXI OS — tools — schema validator.
 *
 * Minimal JSON Schema (draft-07 subset) validator for tool-call argument
 * validation. Handles type, required, properties, items, enum, and nested
 * oneOf-less objects. Returns { valid, errors }.
 */

function typeCheck(value, schema) {
  const type = schema.type;
  if (type === 'object') return typeof value === 'object' && value !== null && !Array.isArray(value);
  if (type === 'array') return Array.isArray(value);
  if (type === 'string') return typeof value === 'string';
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'null') return value === null;
  if (Array.isArray(type)) return type.some((t) => typeCheck(value, { type: t }));
  return true; // no type constraint → pass
}

function validateInternal(value, schema, path, errors) {
  if (schema === undefined || schema === null) return;
  if (schema.anyOf) {
    const sub = schema.anyOf.find((s) => !validateInternal(value, s, path, []).length);
    if (!sub) { errors.push(`${path}: does not match anyOf`); return; }
    validateInternal(value, sub, path, errors);
    return;
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path}: value not in enum ${JSON.stringify(schema.enum)}`);
    return;
  }
  if (!typeCheck(value, schema)) {
    errors.push(`${path}: expected type ${JSON.stringify(schema.type)}, got ${typeof value}`);
    return;
  }
  if (schema.type === 'object' && value && typeof value === 'object') {
    for (const req of schema.required ?? []) {
      if (!(req in value)) errors.push(`${path}: missing required property "${req}"`);
    }
    if (schema.properties) {
      for (const [key, subSchema] of Object.entries(schema.properties)) {
        if (key in value) validateInternal(value[key], subSchema, `${path}.${key}`, errors);
      }
    }
  }
  if (schema.type === 'array' && Array.isArray(value) && schema.items) {
    value.forEach((item, i) => validateInternal(item, schema.items, `${path}[${i}]`, errors));
  }
  return errors;
}

export function validateSchema(value, schema) {
  const errors = [];
  validateInternal(value, schema ?? { type: 'object' }, '$', errors);
  return { valid: errors.length === 0, errors };
}
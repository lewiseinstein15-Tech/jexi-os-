/**
 * B142 — SDK CODEC (DeepSeek Harness `packages/sdk/codec` mirror,
 * JEXI-branded).
 *
 * Wire codec for SDK payloads: encode typed values to JSON-safe wire form,
 * decode with schema validation (unknown keys rejected, required enforced),
 * and a tagged-value codec for projections (dsh typert codec analog).
 *
 *   encodeWire(value)  → JSON-safe deep copy (throws on unsafe)
 *   decodeWire(value, schema) → { ok, value } | { ok:false, code, message }
 *   encodeTagged(tag, value) / decodeTagged(msg) → { tag, value }
 */

/** JSON-safe deep copy; throws on unsafe values. */
export function encodeWire(value, label = 'value') {
  const seen = new Set();
  const visit = (v, key) => {
    if (v === null || v === undefined) return v;
    const t = typeof v;
    if (t === 'number' || t === 'string' || t === 'boolean') return v;
    if (t === 'bigint' || t === 'function' || t === 'symbol') throw new TypeError(`${label} contains a ${t} at "${key}"`);
    if (t === 'object') {
      if (seen.has(v)) throw new TypeError(`${label} is circular at "${key}"`);
      seen.add(v);
      if (Array.isArray(v)) return v.map((x, i) => visit(x, `${key}[${i}]`));
      const out = {};
      for (const [k, val] of Object.entries(v)) {
        if (val === undefined || typeof val === 'function' || typeof val === 'symbol') continue;
        out[k] = visit(val, `${key}.${k}`);
      }
      return out;
    }
    throw new TypeError(`${label} has unsupported type ${t} at "${key}"`);
  };
  return visit(value, label);
}

/** Decode wire values against a schema (required/unknown/type checks). */
export function decodeWire(value, schema) {
  if (!schema) return { ok: true, value };
  const safe = (() => { try { return encodeWire(value, 'payload'); } catch { return null; } })();
  if (safe === null && value !== null && typeof value === 'object') {
    return { ok: false, code: 'unsafe', message: 'payload is not JSON-safe' };
  }
  const fields = schema.fields || {};
  if (schema.required && Array.isArray(schema.required)) {
    for (const key of schema.required) {
      if (safe === null || typeof safe !== 'object' || safe[key] === undefined || safe[key] === null) {
        return { ok: false, code: 'required', message: `missing required field "${key}"` };
      }
    }
  }
  if (schema.strict !== false && safe !== null && typeof safe === 'object') {
    for (const key of Object.keys(safe)) {
      if (!(key in fields)) return { ok: false, code: 'unknown', message: `unknown field "${key}"` };
    }
  }
  for (const [key, type] of Object.entries(fields)) {
    if (safe === null || typeof safe !== 'object' || safe[key] === undefined || safe[key] === null) continue;
    if (type === 'number' && typeof safe[key] !== 'number') return { ok: false, code: 'type', message: `field "${key}" must be ${type}` };
    if (type === 'string' && typeof safe[key] !== 'string') return { ok: false, code: 'type', message: `field "${key}" must be ${type}` };
    if (type === 'boolean' && typeof safe[key] !== 'boolean') return { ok: false, code: 'type', message: `field "${key}" must be ${type}` };
  }
  return { ok: true, value: safe };
}

/** Tagged-value codec: { t: tag, v: value } with strict shape. */
export function encodeTagged(tag, value) {
  return { t: String(tag || ''), v: encodeWire(value, `tagged:${tag}`) };
}

/** Decode a tagged message; returns { ok, tag, value } or an error. */
export function decodeTagged(msg) {
  if (msg === null || typeof msg !== 'object' || typeof msg.t !== 'string' || !('v' in msg)) {
    return { ok: false, error: 'tagged message must be { t: string, v: value }' };
  }
  try {
    return { ok: true, tag: msg.t, value: encodeWire(msg.v, 'tagged value') };
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'tagged value not JSON-safe' };
  }
}

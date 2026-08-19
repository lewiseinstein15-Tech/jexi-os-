/**
 * B141 — API PROXY (DeepSeek Harness `packages/host/apiproxy` mirror,
 * JEXI-branded).
 *
 * Typed API-route schemas: every proxied /api route declares a schema
 * ({ required, fields }) and JSON arguments are validated against it before
 * dispatch (dsh assertJsonArgs + route validation). Validation is strict:
 * extra top-level keys are rejected, missing required keys fail with the
 * schema-required code, and type mismatches are reported per field.
 *
 *   validateApiArgs(args, schema) → { ok, value } | { ok: false, code, message }
 *   assertJsonArgs(args)          → JSON-safe deep copy (throws on unsafe)
 *   createApiProxy(defaults)      → { validate(route, args), routeSchema(route) }
 */

/** Deep JSON-safe copy; throws on unsafe values (BigInt/function/circular). */
export function assertJsonArgs(event, args) {
  const seen = new Set();
  const visit = (v, key) => {
    if (v === null || v === undefined) return v;
    const t = typeof v;
    if (t === 'number' || t === 'string' || t === 'boolean') return v;
    if (t === 'bigint' || t === 'function' || t === 'symbol') throw new TypeError(`arg "${key}" is not JSON-safe (${t})`);
    if (t === 'object') {
      if (seen.has(v)) throw new TypeError(`arg "${key}" is circular`);
      seen.add(v);
      if (Array.isArray(v)) return v.map((x, i) => visit(x, `${key}[${i}]`));
      const out = {};
      for (const [k, val] of Object.entries(v)) out[k] = visit(val, `${key}.${k}`);
      return out;
    }
    throw new TypeError(`arg "${key}" has unsupported type ${t}`);
  };
  return visit(args, event);
}

const TYPES = ['string', 'number', 'boolean', 'object', 'array'];

/** Validate JSON args against a route schema. */
export function validateApiArgs(args, schema) {
  if (!schema) return { ok: true, value: args };
  const value = (() => { try { return assertJsonArgs('api-proxy', args); } catch { return null; } })();
  if (value === null && args !== null && typeof args === 'object') {
    return { ok: false, code: 'schema-invalid', message: 'arguments are not JSON-safe' };
  }
  const allowed = new Set(Object.keys(schema.fields || {}));
  if (schema.required && Array.isArray(schema.required)) {
    for (const key of schema.required) {
      if (value === null || typeof value !== 'object' || value[key] === undefined || value[key] === null) {
        return { ok: false, code: 'schema-required', message: `missing required argument "${key}"` };
      }
    }
  }
  if (schema.strict !== false && value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      if (!allowed.has(key)) return { ok: false, code: 'schema-unknown', message: `unknown argument "${key}"` };
    }
  }
  for (const [key, type] of Object.entries(schema.fields || {})) {
    if (value === null || typeof value !== 'object' || value[key] === undefined || value[key] === null) continue;
    if (TYPES.includes(type) && typeof value[key] !== type) {
      return { ok: false, code: 'schema-type', message: `argument "${key}" must be ${type} (got ${typeof value[key]})` };
    }
  }
  return { ok: true, value };
}

/** API proxy with per-route schemas + defaults. */
export function createApiProxy({ defaults = {}, routes: initialRoutes = {} } = {}) {
  return {
    defaults,
    routes: { ...initialRoutes },
    /** Validate args for one route (unknown route → pass-through). */
    validate(route, args) {
      const schema = this.routes[String(route || '')];
      return validateApiArgs(args, schema || null);
    },
    /** Register (or replace) one route schema. */
    routeSchema(route, schema) {
      this.routes[String(route || '')] = schema || null;
      return this;
    },
  };
}

/** Status for /api/apiproxy. */
export function apiProxyStatus(proxy) {
  return {
    ok: true,
    routes: Object.keys((proxy && proxy.routes) || {}).sort(),
    defaults: (proxy && proxy.defaults) || {},
  };
}

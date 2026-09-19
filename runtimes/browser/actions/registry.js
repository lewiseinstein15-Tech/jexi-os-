/**
 * JEXI OS — Phase 17 Scope B — ACTION REGISTRY.
 *
 * Ported from browser-use's `tools/registry/service.py`: actions are declared
 * with a name, a model-facing description, a JSON Schema for input, a JSON
 * Schema for output, and a handler. The registry validates input against the
 * schema, enforces permissions and risk, applies a timeout, retries where the
 * action opts in, and returns a uniform result envelope.
 *
 *   registry.register({ name, description, input_schema, output_schema,
 *                       handler, risk, permissions, timeout_ms, retries })
 *   await registry.dispatch('click_element', { index: 3 }, ctx)
 *
 * ── RISK + PERMISSIONS ─────────────────────────────────────────────────────
 * Every action carries a risk level and the permissions it needs. The registry
 * refuses an action whose permission is not granted, and refuses `high`-risk
 * actions unless explicitly allowed — this is where the BrowserRouter
 * CAPTCHA/challenge policy is enforced at the action layer.
 *
 *   risk:        'low' | 'medium' | 'high'
 *   permissions: 'navigate' | 'read' | 'interact' | 'write' | 'eval'
 *                | 'filesystem' | 'network' | 'admin'
 *
 * ── NO STUBS ───────────────────────────────────────────────────────────────
 * Every handler performs a real CDP call. Actions Obscura cannot support are
 * not included — see cdp.js for the probed capability list. Actions whose
 * engine dependency is gated (file upload) surface the engine's own refusal
 * rather than pretending to succeed.
 */

/** Risk levels, most dangerous last. */
export const RISK_LEVELS = ['low', 'medium', 'high'];

/** Permission flags an action may require. */
export const PERMISSIONS = ['navigate', 'read', 'interact', 'write', 'eval', 'filesystem', 'network', 'admin'];

export class ActionError extends Error {
  constructor(action, detail, { code = 'E_ACTION' } = {}) {
    super(`ActionError: ${action} — ${detail}`);
    this.name = 'ActionError';
    this.action = action;
    this.code = code;
  }
}

export class ActionValidationError extends ActionError {
  constructor(action, detail) {
    super(action, detail, { code: 'E_ACTION_VALIDATION' });
    this.name = 'ActionValidationError';
  }
}

export class ActionPermissionError extends ActionError {
  constructor(action, detail) {
    super(action, detail, { code: 'E_ACTION_PERMISSION' });
    this.name = 'ActionPermissionError';
  }
}

export class ActionTimeoutError extends ActionError {
  constructor(action, ms) {
    super(action, `no result within ${ms}ms`, { code: 'E_ACTION_TIMEOUT' });
    this.name = 'ActionTimeoutError';
  }
}

export class ActionNotFoundError extends ActionError {
  constructor(action, available) {
    super(action, `not registered. Available: ${available.slice(0, 12).join(', ')}${available.length > 12 ? `, … (${available.length} total)` : ''}`, { code: 'E_ACTION_NOT_FOUND' });
    this.name = 'ActionNotFoundError';
  }
}

/* ── minimal JSON Schema validation ─────────────────────────────────────── */

const TYPE_CHECKS = {
  string: (v) => typeof v === 'string',
  number: (v) => typeof v === 'number' && Number.isFinite(v),
  integer: (v) => Number.isInteger(v),
  boolean: (v) => typeof v === 'boolean',
  object: (v) => v !== null && typeof v === 'object' && !Array.isArray(v),
  array: (v) => Array.isArray(v),
  null: (v) => v === null,
};

/**
 * Validate a value against a JSON Schema subset (type, required, enum,
 * minimum/maximum, minItems/maxItems, items, properties,
 * additionalProperties). Deliberately small — the schemas here are authored
 * alongside the validators.
 *
 * @returns {string[]} problems; empty means valid
 */
export function validateAgainstSchema(value, schema, path = '$') {
  const problems = [];
  if (!schema || typeof schema !== 'object') return problems;

  if (schema.enum) {
    if (!schema.enum.some((e) => e === value)) {
      problems.push(`${path}: expected one of ${JSON.stringify(schema.enum)}, got ${JSON.stringify(value)}`);
    }
    return problems;
  }

  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (types.length && !types.some((t) => TYPE_CHECKS[t]?.(value))) {
    problems.push(`${path}: expected ${types.join('|')}, got ${value === null ? 'null' : typeof value}`);
    return problems;
  }

  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) problems.push(`${path}: ${value} < minimum ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) problems.push(`${path}: ${value} > maximum ${schema.maximum}`);
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) problems.push(`${path}: shorter than minLength ${schema.minLength}`);
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) problems.push(`${path}: does not match pattern ${schema.pattern}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) problems.push(`${path}: fewer than minItems ${schema.minItems}`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) problems.push(`${path}: more than maxItems ${schema.maxItems}`);
    if (schema.items) value.forEach((v, i) => problems.push(...validateAgainstSchema(v, schema.items, `${path}[${i}]`)));
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const req of schema.required || []) {
      if (value[req] === undefined) problems.push(`${path}: missing required property "${req}"`);
    }
    const props = schema.properties || {};
    for (const [k, v] of Object.entries(value)) {
      if (props[k]) problems.push(...validateAgainstSchema(v, props[k], `${path}.${k}`));
      else if (schema.additionalProperties === false) problems.push(`${path}: unexpected property "${k}"`);
    }
  }
  return problems;
}

/* ── registry ───────────────────────────────────────────────────────────── */

export class ActionRegistry {
  /**
   * @param {object} [o]
   * @param {string[]} [o.grantedPermissions]
   * @param {boolean} [o.allowHighRisk] required for any 'high'-risk action
   * @param {boolean} [o.allowPrivateNetwork] forwarded to actions that dial
   */
  constructor({ grantedPermissions = ['navigate', 'read', 'interact'], allowHighRisk = false, allowPrivateNetwork = false } = {}) {
    this.actions = new Map();
    this.grantedPermissions = new Set(grantedPermissions);
    this.allowHighRisk = allowHighRisk;
    this.allowPrivateNetwork = allowPrivateNetwork;
    this.metrics = new Map();  // name → { calls, errors, total_ms }
  }

  /**
   * Register an action.
   * @param {object} spec
   * @param {string} spec.name
   * @param {string} spec.description
   * @param {object} spec.input_schema
   * @param {object} [spec.output_schema]
   * @param {(input: object, ctx: object, meta: object) => Promise<any>} spec.handler
   * @param {'low'|'medium'|'high'} [spec.risk]
   * @param {string[]} [spec.permissions]
   * @param {number} [spec.timeout_ms]
   * @param {number} [spec.retries]
   */
  register(spec) {
    const { name, description, input_schema, handler } = spec;
    if (!name || typeof name !== 'string') throw new ActionError('register', 'name is required');
    if (this.actions.has(name)) throw new ActionError(name, 'already registered');
    if (typeof handler !== 'function') throw new ActionError(name, 'handler must be a function');
    if (!input_schema || input_schema.type !== 'object') throw new ActionError(name, 'input_schema must be an object schema');
    if (spec.risk && !RISK_LEVELS.includes(spec.risk)) throw new ActionError(name, `risk must be one of ${RISK_LEVELS.join('|')}`);
    for (const p of spec.permissions || []) {
      if (!PERMISSIONS.includes(p)) throw new ActionError(name, `unknown permission "${p}"`);
    }
    this.actions.set(name, {
      name,
      description: description || '',
      input_schema,
      output_schema: spec.output_schema || { type: 'object' },
      handler,
      risk: spec.risk || 'medium',
      permissions: spec.permissions || ['interact'],
      timeout_ms: spec.timeout_ms ?? 30_000,
      retries: spec.retries ?? 0,
    });
    return this;
  }

  /** Register many actions at once. */
  registerAll(specs) {
    for (const s of specs) this.register(s);
    return this;
  }

  has(name) { return this.actions.has(name); }
  get(name) { return this.actions.get(name); }
  names() { return [...this.actions.keys()]; }
  size() { return this.actions.size; }

  /**
   * The action catalogue as JSON — what a model is shown when choosing.
   * @param {{riskAtMost?: string}} [o]
   */
  catalogue({ riskAtMost } = {}) {
    const maxIdx = riskAtMost ? RISK_LEVELS.indexOf(riskAtMost) : RISK_LEVELS.length - 1;
    return [...this.actions.values()]
      .filter((a) => RISK_LEVELS.indexOf(a.risk) <= maxIdx)
      .map((a) => ({
        name: a.name,
        description: a.description,
        risk: a.risk,
        permissions: a.permissions,
        input_schema: a.input_schema,
      }));
  }

  /** Check permissions and risk before running. */
  authorise(action) {
    if (action.risk === 'high' && !this.allowHighRisk) {
      throw new ActionPermissionError(action.name, 'risk level "high" requires allowHighRisk (challenge/CAPTCHA bypass is out of policy)');
    }
    for (const p of action.permissions) {
      if (!this.grantedPermissions.has(p)) {
        throw new ActionPermissionError(action.name, `permission "${p}" not granted (granted: ${[...this.grantedPermissions].join(', ') || 'none'})`);
      }
    }
  }

  /**
   * Validate input, run the handler with timeout + retries, return a uniform
   * envelope. Throws ActionError subclasses; never returns a fake success.
   *
   * @param {string} name
   * @param {object} [input]
   * @param {object} [ctx] passed to the handler (session, dom, engine…)
   */
  async dispatch(name, input = {}, ctx = {}) {
    const action = this.actions.get(name);
    if (!action) throw new ActionNotFoundError(name, this.names());

    const problems = validateAgainstSchema(input, action.input_schema);
    if (problems.length) throw new ActionValidationError(name, problems.join('; '));
    this.authorise(action);

    const started = Date.now();
    const stats = this.metrics.get(name) || { calls: 0, errors: 0, total_ms: 0 };
    stats.calls++;

    let lastError = null;
    for (let attempt = 0; attempt <= action.retries; attempt++) {
      try {
        const result = await this._withTimeout(action.handler(input, ctx, { attempt }), action.timeout_ms, name);
        const outputProblems = validateAgainstSchema(result, action.output_schema);
        if (outputProblems.length) {
          throw new ActionError(name, `handler returned a result that does not match output_schema: ${outputProblems.join('; ')}`, { code: 'E_ACTION_OUTPUT' });
        }
        stats.total_ms += Date.now() - started;
        this.metrics.set(name, stats);
        return { ok: true, action: name, attempt, result, ms: Date.now() - started };
      } catch (e) {
        lastError = e;
        const retryable = e.code === 'E_ACTION_TIMEOUT' || /transient|detached|no node|execution context/i.test(e.message);
        if (attempt >= action.retries || !retryable) break;
        await new Promise((r) => setTimeout(r, 100 * (attempt + 1)));
      }
    }

    stats.errors++;
    stats.total_ms += Date.now() - started;
    this.metrics.set(name, stats);
    throw lastError;
  }

  _withTimeout(promise, ms, name) {
    if (!ms || ms <= 0) return promise;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new ActionTimeoutError(name, ms)), ms);
      promise.then(
        (v) => { clearTimeout(timer); resolve(v); },
        (e) => { clearTimeout(timer); reject(e); },
      );
    });
  }

  /** Per-action call/error/timing counters. */
  report() {
    return [...this.actions.keys()].map((name) => {
      const s = this.metrics.get(name) || { calls: 0, errors: 0, total_ms: 0 };
      return { name, ...s, avg_ms: s.calls ? Math.round(s.total_ms / s.calls) : 0 };
    });
  }
}

/** Short risk label for reports. */
export function riskLabel(risk) {
  return { low: 'LOW', medium: 'MED', high: 'HIGH' }[risk] || String(risk).toUpperCase();
}

export default { ActionRegistry, ActionError, ActionValidationError, ActionPermissionError, ActionTimeoutError, ActionNotFoundError, validateAgainstSchema, RISK_LEVELS, PERMISSIONS };

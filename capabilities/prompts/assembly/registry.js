// prompt/assembly/registry.js
// Section registry for JEXI prompt assembly (Phase 25, Scope A).
//
// A prompt is NOT a monolithic blob. It is an ordered list of typed
// sections, each with its own budget and builder. The registry is the
// single source of truth for which sections exist, in what order,
// under what constraints.
//
// Design notes:
// - Factory-based (createSectionRegistry) so probes/tests get isolated
//   registries; a shared defaultRegistry is exported for downstream
//   assembly code in later scopes.
// - Registered specs are shallow-frozen: the registry is append-only,
//   and the runtime refuses mutation-after-registration where the
//   language allows it to be observed.
// - All refusals throw PromptError with a stable code (see errors.js).

import { PromptError, isPromptError } from './errors.js';

export { PromptError, isPromptError };

const VALID_KINDS = new Set(['static', 'dynamic']);
const ID_PATTERN = /^[a-z][a-z0-9-]*$/;

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isPositiveInt(v) {
  return Number.isInteger(v) && v > 0;
}

/**
 * Create an isolated section registry.
 * @param {object} [options]
 * @param {number} [options.maxOrder=999] - upper bound for valid order slots
 */
export function createSectionRegistry(options = {}) {
  const maxOrder = options.maxOrder ?? 999;
  const byId = new Map();
  const byOrder = new Map();

  /**
   * Register a section spec.
   * Spec shape:
   *   { id, label, order, kind: 'static'|'dynamic',
   *     budget: { maxChars, weight }, build(ctx) -> string }
   *
   * Refusals (PromptError codes):
   *   E_INVALID_SECTION   - spec is not a plain object
   *   E_INVALID_ID        - id missing or malformed (lowercase-hyphen)
   *   E_DUPLICATE_SECTION - id already registered
   *   E_INVALID_LABEL     - label missing or empty
   *   E_INVALID_ORDER     - order not a positive integer within maxOrder
   *   E_ORDER_COLLISION   - another section already occupies the order slot
   *   E_INVALID_KIND      - kind is not 'static' | 'dynamic'
   *   E_INVALID_BUDGET    - budget.maxChars / budget.weight malformed
   *   E_INVALID_BUILD     - build is not a function
   *
   * @returns {object} the frozen stored spec
   */
  function register(spec) {
    if (!isPlainObject(spec)) {
      throw new PromptError('E_INVALID_SECTION', 'section spec must be a plain object', { got: typeof spec });
    }
    const { id, label, order, kind, budget, build } = spec;

    if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
      throw new PromptError('E_INVALID_ID', `section id must match ${ID_PATTERN}`, { id: String(id) });
    }
    if (byId.has(id)) {
      throw new PromptError('E_DUPLICATE_SECTION', `section already registered: ${id}`, { id });
    }
    if (typeof label !== 'string' || label.trim() === '') {
      throw new PromptError('E_INVALID_LABEL', 'section label must be a non-empty string', { id, label: String(label) });
    }
    if (!isPositiveInt(order) || order > maxOrder) {
      throw new PromptError('E_INVALID_ORDER', 'section order must be a positive integer within maxOrder', { id, order, maxOrder });
    }
    if (byOrder.has(order)) {
      const takenBy = byOrder.get(order).id;
      throw new PromptError('E_ORDER_COLLISION', `order slot ${order} already taken by "${takenBy}"`, { id, order, takenBy });
    }
    if (!VALID_KINDS.has(kind)) {
      throw new PromptError('E_INVALID_KIND', "kind must be 'static' or 'dynamic'", { id, kind: String(kind) });
    }
    const budgetOk =
      isPlainObject(budget) &&
      isPositiveInt(budget.maxChars) &&
      typeof budget.weight === 'number' &&
      Number.isFinite(budget.weight) &&
      budget.weight > 0;
    if (!budgetOk) {
      throw new PromptError('E_INVALID_BUDGET', 'budget must be { maxChars: positive int, weight: positive finite number }', { id });
    }
    if (typeof build !== 'function') {
      throw new PromptError('E_INVALID_BUILD', 'build must be a function (ctx) => string', { id });
    }

    const stored = Object.freeze({ ...spec, budget: Object.freeze({ ...budget }) });
    byId.set(id, stored);
    byOrder.set(order, stored);
    return stored;
  }

  /** All registered sections, sorted by order. */
  function list() {
    return [...byId.values()].sort((a, b) => a.order - b.order);
  }

  /** One section spec by id; null when absent (callers decide what to do). */
  function get(id) {
    return byId.get(id) ?? null;
  }

  function has(id) {
    return byId.has(id);
  }

  function size() {
    return byId.size;
  }

  /** Isolation hook for probes/tests: empties the registry. */
  function reset() {
    byId.clear();
    byOrder.clear();
  }

  return { register, list, get, has, size, reset };
}

// Shared singleton for downstream assembly code. Probes and tests
// should prefer createSectionRegistry() for isolation.
export const defaultRegistry = createSectionRegistry();

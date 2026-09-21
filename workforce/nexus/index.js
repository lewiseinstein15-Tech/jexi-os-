/**
 * JEXI OS — PHASE 13 SCOPE C — NEXUS STRATEGY LAYER (facade).
 *
 *   import { createNexus } from './workforce/nexus/index.js';
 *   const nexus = createNexus();
 *   nexus.load().strategies.length;                       // 24
 *   nexus.route({ kind: 'research', description: 'size the market' });
 *
 * Or the module-level default router, bound to this repo:
 *
 *   import { load, route, validate, strategies } from './workforce/nexus/index.js';
 *   load();                                    // explicit; later calls are lazy
 *   route({ kind: 'build', description: 'ship the widget' });
 *   strategies().map((s) => s.id);
 *   validate({ kind: 'x', description: 'y' });  // -> { valid: true }
 *
 * The default router is lazy: the first query reads disk, later queries reuse
 * the snapshot. Call `refreshNexus()` to re-read after projection changes.
 *
 * Surface:
 *   createNexus(opts)          — new, independent router
 *   load(root?)                — load the default router -> { strategies: [] }
 *   route(intent, context?)    — -> { strategy, division, agent, reason, warnings }
 *   validate(intent)           — -> { valid, errors? }
 *   get(strategyId)            — one strategy; unknown id -> E_UNKNOWN_STRATEGY
 *   strategies()               — every strategy, sorted by id
 *   kinds()                    — every routing token
 *   refreshNexus()             — re-read disk into the default router
 *   resolveReference(ref, agents)
 *                              — -> { resolved: string[], warnings: string[] }
 */

import { createNexus, validateIntent, resolveReference, INTENT_REQUIRED } from './orchestration.js';
import * as strategy from './strategy.js';
import * as docs from './docs.js';
import * as orchestration from './orchestration.js';

let _default = null;

/** The lazily-created default nexus router, bound to this repo root. */
export function defaultNexus() {
  if (!_default) _default = createNexus();
  return _default;
}

/** Load the default router. `root` overrides the inferred repo root once. */
export function load(root) {
  return defaultNexus().load(root);
}

/** The loaded router, loading it if this is the first call. */
export function nexus() {
  const n = defaultNexus();
  if (!n.size) n.load();
  return n;
}

export function route(intent, context) { return nexus().route(intent, context); }
export function validate(intent) { return nexus().validate(intent); }
export function get(strategyId) { return nexus().get(strategyId); }
export function strategies() { return nexus().strategies(); }
export function kinds() { return nexus().kinds(); }
export function provenance() { return nexus().provenance(); }
export function refreshNexus() { return nexus().refresh(); }

export { createNexus, validateIntent, resolveReference, INTENT_REQUIRED, strategy, docs, orchestration };

export {
  STRATEGY_VERSION, SCOPES, REQUIRED_FIELDS, ERRORS, StrategyError,
  normalize as normalizeStrategy, validate as validateStrategy, isValid as isValidStrategy,
  tokens, canonicalToken,
} from './strategy.js';

export {
  PROJECTION_PATH, UPSTREAM_DOCS, DocsError, loadProjection, inspectCheckout,
} from './docs.js';
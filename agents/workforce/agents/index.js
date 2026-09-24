/**
 * JEXI OS — PHASE 13 SCOPE A — BULK AGENT ROSTER (facade).
 *
 *   import { createRegistry } from './workforce/agents/index.js';
 *   const agents = createRegistry();
 *   const { count } = agents.load();
 *
 * Or the module-level default registry, which reads the repo this file lives in:
 *
 *   import { load, get, list, validate } from './workforce/agents/index.js';
 *   load().count;
 *   get('architect');
 *   list({ division: 'security' }).length;
 *   validate({ id: 'x', ... });
 *
 * The default registry is lazy: the first call reads disk, later calls reuse
 * the snapshot. Call `refreshRoster()` after changing agent files on disk.
 *
 * Surface:
 *   createRegistry(opts)  — new, independent registry
 *   load(root?)           — load the default registry  -> { count, agents[] }
 *   get(id)               — one spec by id, or null
 *   list({ division? })   — specs, optionally one division
 *   validate(spec)        — { valid, errors? }
 *   refreshRoster()       — re-read disk into the default registry
 *   stats() / divisions() / errors() / duplicates()
 */

import { createRegistry } from './registry.js';
import * as spec from './agent-spec.js';
import * as loader from './loader.js';
import { inferCapabilities } from './capabilities.js';
import { inferDivision, initialTrustLevel } from './infer.js';

let _default = null;

/** The lazily-created default registry, bound to this module's repo root. */
export function defaultRegistry() {
  if (!_default) _default = createRegistry();
  return _default;
}

/** Load the default registry. `root` overrides the inferred repo root once. */
export function load(root) {
  const reg = defaultRegistry();
  return reg.load(root);
}

/** The loaded snapshot, loading it if this is the first call. */
export function roster() {
  const reg = defaultRegistry();
  if (!reg.size) reg.load();
  return reg;
}

export function get(id) { return roster().get(id); }
export function list(filter) { return roster().list(filter); }
export function validate(specInput, opts) { return roster().validate(specInput, opts); }
export function has(id) { return roster().has(id); }
export function stats() { return roster().stats(); }
export function divisions() { return roster().divisions(); }
export function errors() { return roster().errors(); }
export function duplicates() { return roster().duplicates(); }
export function refreshRoster() { return roster().refresh(); }

export {
  createRegistry, spec, loader, inferCapabilities, inferDivision, initialTrustLevel,
};

export {
  SPEC_VERSION, REQUIRED_FIELDS, TRUST_LEVELS, CAPABILITIES, ERRORS,
  validate as validateSpec, isValid, makeSpec,
} from './agent-spec.js';

export { loadDir } from './loader.js';

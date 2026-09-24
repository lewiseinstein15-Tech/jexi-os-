/**
 * JEXI OS — PHASE 13 SCOPE B — 18 DIVISIONS (facade).
 *
 *   import { createDivisionRegistry } from './workforce/divisions/index.js';
 *   const divisions = createDivisionRegistry();
 *   divisions.load().length;               // 18
 *   divisions.members('engineering').length;
 *   divisions.assign('architect', 'security');
 *
 * Or the module-level default registry, bound to this repo:
 *
 *   import { load, get, members, assign, unassign, counts } from './workforce/divisions/index.js';
 *   load();                                 // explicit; later calls are lazy
 *   get('engineering');
 *   members('security').length;
 *   assign('architect', 'security');        // transfer
 *   unassign('architect');
 *   counts();
 *
 * The default registry is lazy: the first query reads disk, later queries reuse
 * the snapshot. Call `refreshDivisions()` to re-read after data changes.
 *
 * Surface:
 *   createDivisionRegistry(opts)  — new, independent registry
 *   load(root?)                   — load the default registry -> divisions[]
 *   get(id)                       — one division (live count + capabilities)
 *   members(divisionId)           — agents[], sorted by id
 *   assign(agentId, divisionId)   — place/transfer an agent
 *   unassign(agentId)             — remove an agent from its division
 *   counts()                      — { [divisionId]: number }
 *   refreshDivisions()            — re-read disk into the default registry
 */

import { createDivisionRegistry } from './registry.js';
import * as division from './division.js';
import * as registry from './registry.js';

let _default = null;

/** The lazily-created default division registry, bound to this repo root. */
export function defaultRegistry() {
  if (!_default) _default = createDivisionRegistry();
  return _default;
}

/** Load the default registry. `root` overrides the inferred root once. */
export function load(root) {
  return defaultRegistry().load(root);
}

/** The loaded snapshot, loading it if this is the first call. */
export function divisions() {
  const reg = defaultRegistry();
  if (!reg.size) reg.load();
  return reg;
}

export function get(id) { return divisions().get(id); }
export function members(divisionId) { return divisions().members(divisionId); }
export function assign(agentId, divisionId) { return divisions().assign(agentId, divisionId); }
export function unassign(agentId) { return divisions().unassign(agentId); }
export function counts() { return divisions().counts(); }
export function assignedCount() { return divisions().assignedCount(); }
export function has(id) { return divisions().has(id); }
export function errors() { return divisions().errors(); }
export function refreshDivisions() { return divisions().refresh(); }

export { createDivisionRegistry, division, registry };

export {
  DIVISION_VERSION, REQUIRED_FIELDS, ERRORS, DivisionError,
  normalize, validate, isValid, identity,
} from './division.js';
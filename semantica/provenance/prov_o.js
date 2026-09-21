/**
 * JEXI OS — Phase 14 Scope B — W3C PROV-O model.
 *
 * The three PROV-O primitive classes as immutable records:
 *   prov:Agent    — who asserted a fact (a person, service, sensor)
 *   prov:Activity — the action that produced the fact (a run, an import)
 *   prov:Entity   — the thing the fact is about (a graph node/edge)
 *
 * Records are frozen at construction; provenance chains reference
 * these by value, never by mutable handle.
 */
import { fail, assertNonEmptyString, assertProps } from '../_internal.js';

export const PROV_TYPES = Object.freeze(['Entity', 'Activity', 'Agent']);

function make(type) {
  return function build({ id, label, props } = {}) {
    assertNonEmptyString(id, `${type} id`, 'E_INVALID_PROV_ID');
    const bag = assertProps(props, type);
    return Object.freeze({ provType: type, id, label: label ?? '', props: Object.freeze({ ...bag }) });
  };
}

export const makeAgent = make('Agent');
export const makeActivity = make('Activity');
export const makeEntity = make('Entity');

export function assertProvRef(ref, role) {
  if (ref === undefined || ref === null) {
    throw fail('E_INVALID_PROVENANCE', `provenance ${role} is required`);
  }
  if (typeof ref === 'string') return ref; // plain id is acceptable
  if (typeof ref === 'object' && PROV_TYPES.includes(ref.provType)) return ref;
  throw fail('E_INVALID_PROVENANCE', `provenance ${role} must be an id string or a PROV-O record, got ${typeof ref}`);
}

/**
 * JEXI OS — Phase 14 Scope B — attach provenance to nodes/edges.
 *
 *   prov.attach(target, { agent, activity, source, when, parent? }) -> target
 *   prov.of(target) -> guarded record | undefined
 *
 * Records live in a side registry keyed by object identity (Scope A
 * nodes/edges are frozen and must stay byte-stable). A target gets
 * provenance exactly once: a second attach, or any set/delete on the
 * returned record, throws E_PROV_IMMUTABLE. `parent` links this
 * record to an already-attached target's record, forming the chain
 * that trace() walks.
 */
import { fail } from '../_internal.js';
import { assertProvRef } from './prov_o.js';

/** target object -> raw frozen record */
const registry = new WeakMap();

/**
 * Guarded view: plain values behind throwing accessors. A proxy would
 * break the frozen-target invariant under JSON.stringify, so the
 * record is re-exposed as an accessor object whose setters throw
 * E_PROV_IMMUTABLE and whose `parent` getter lazily guards the chain.
 */
function guard(raw) {
  if (raw === null || typeof raw !== 'object') return raw;
  const o = {};
  const immut = () => { throw fail('E_PROV_IMMUTABLE', 'provenance is immutable after attach'); };
  for (const key of ['agent', 'activity', 'source', 'when']) {
    Object.defineProperty(o, key, { enumerable: true, configurable: false, get: () => raw[key], set: immut });
  }
  Object.defineProperty(o, 'parent', { enumerable: true, configurable: false, get: () => (raw.parent ? guard(raw.parent) : null), set: immut });
  return o;
}

export function attach(target, { agent, activity, source, when, parent } = {}) {
  if (!target || typeof target !== 'object') {
    throw fail('E_INVALID_TARGET', 'provenance attaches to a node/edge object');
  }
  if (registry.has(target)) {
    throw fail('E_PROV_IMMUTABLE', 'this target already carries provenance; records are immutable');
  }
  const a = assertProvRef(agent, 'agent');
  const ac = assertProvRef(activity, 'activity');
  const s = assertProvRef(source, 'source');
  if (when === undefined || when === null || (typeof when !== 'string' && typeof when !== 'number')) {
    throw fail('E_INVALID_PROVENANCE', 'provenance when (timestamp) is required');
  }
  let parentRecord = null;
  if (parent !== undefined && parent !== null) {
    parentRecord = registry.get(parent);
    if (!parentRecord) {
      throw fail('E_MISSING_PROVENANCE', 'provenance parent target has no provenance of its own');
    }
  }
  const raw = Object.freeze({ agent: a, activity: ac, source: s, when, parent: parentRecord });
  registry.set(target, raw);
  return target;
}

export function of(target) {
  const raw = registry.get(target);
  return raw ? guard(raw) : undefined;
}

/** Internal: raw record for trace(); undefined when unattached. */
export function rawOf(target) {
  return registry.get(target);
}

/** Internal: guarded view of a raw record (for trace()). */
export function guarded(raw) {
  return guard(raw);
}

export function has(target) {
  return registry.has(target);
}

/**
 * JEXI OS — Phase 14 Scope B — walk a provenance chain backwards.
 *
 *   trace(target, { depth }) -> [records]
 *
 * Order is always target -> parent -> grandparent -> ... -> root
 * (root.parent === null). depth limits the record count: depth=1 ->
 * 1 record; depth=0 -> just the target's record; undefined -> the
 * full chain to the root. Target without provenance ->
 * E_MISSING_PROVENANCE. Each record has a single parent link, so the
 * walk order is deterministic by construction.
 */
import { fail } from '../_internal.js';
import { rawOf, guarded } from './record.js';

export function trace(target, { depth } = {}) {
  const raw = rawOf(target);
  if (!raw) {
    throw fail('E_MISSING_PROVENANCE', 'target carries no provenance; nothing to trace');
  }
  if (depth !== undefined && (!Number.isInteger(depth) || depth < 0)) {
    throw fail('E_INVALID_DEPTH', `depth must be a non-negative integer, got ${JSON.stringify(depth)}`);
  }
  const limit = depth === undefined ? Infinity : depth <= 0 ? 1 : depth;
  const out = [];
  let cur = raw;
  while (cur && out.length < limit) {
    out.push(guarded(cur));
    cur = cur.parent;
  }
  return out;
}

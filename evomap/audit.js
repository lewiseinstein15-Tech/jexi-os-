/**
 * JEXI OS — Phase 15 Scope E — queryable evolution history.
 *
 * audit({ from?, to? }) filters the append-only event trail by the
 * op-seq `at` field, INCLUSIVE on both ends. No range -> full trail.
 */
import { readEvents } from './gep/events.js';
import { fail } from '../semantica/_internal.js';

export function auditEvents(dir, range = {}) {
  if (range === null || typeof range !== 'object' || Array.isArray(range)) {
    throw fail('E_INVALID_RANGE', 'audit range must be a plain object { from?, to? }');
  }
  const { from, to } = range;
  for (const [k, v] of [['from', from], ['to', to]]) {
    if (v !== undefined && (typeof v !== 'number' || !Number.isInteger(v) || v < 0)) {
      throw fail('E_INVALID_RANGE', 'audit range.' + k + ' must be a non-negative integer, got ' + JSON.stringify(v));
    }
  }
  return readEvents(dir).filter((ev) => {
    if (from !== undefined && ev.at < from) return false;
    if (to !== undefined && ev.at > to) return false;
    return true;
  });
}

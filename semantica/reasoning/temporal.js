/**
 * JEXI OS — Phase 14 Scope E — temporal ordering / window queries.
 *
 *   temporal(graph, { before, after, window }) -> nodes[]
 *
 * Every node in the graph MUST carry a `when` in its provenance
 * (Scope B); a node without one -> E_MISSING_TIMESTAMP. `when` may be
 * an ISO string or epoch number; strings parse via Date.parse.
 *
 * Window semantics are INCLUSIVE on both ends:
 *   after  <= when <= before
 * Either bound may be omitted (open-ended). Results are ordered by
 * (when, id) — deterministic.
 */
import { fail } from '../_internal.js';
import { prov } from '../provenance/index.js';

export function whenOf(graph, node) {
  const rec = prov.of(node);
  if (!rec || rec.when === undefined || rec.when === null) {
    throw fail('E_MISSING_TIMESTAMP', `node "${node.id}" carries no provenance when; temporal reasoning needs timestamps`);
  }
  const t = typeof rec.when === 'number' ? rec.when : Date.parse(rec.when);
  if (Number.isNaN(t)) {
    throw fail('E_MISSING_TIMESTAMP', `node "${node.id}" has an unparseable when: ${JSON.stringify(rec.when)}`);
  }
  return t;
}

export function temporal(graph, { before, after, window } = {}) {
  const w = window ?? { before, after };
  const lo = w.after !== undefined ? (typeof w.after === 'number' ? w.after : Date.parse(w.after)) : -Infinity;
  const hi = w.before !== undefined ? (typeof w.before === 'number' ? w.before : Date.parse(w.before)) : Infinity;
  if (Number.isNaN(lo) || Number.isNaN(hi)) {
    throw fail('E_INVALID_WINDOW', 'window bounds must be ISO strings or epoch numbers');
  }
  const stamped = graph.nodes().map((n) => ({ n, t: whenOf(graph, n) }));
  return stamped
    .filter(({ t }) => t >= lo && t <= hi)
    .sort((a, b) => (a.t !== b.t ? a.t - b.t : (a.n.id < b.n.id ? -1 : 1)))
    .map((x) => x.n);
}

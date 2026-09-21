/**
 * JEXI OS — Phase 14 Scope E — causal chain inference.
 *
 *   causal(graph, from, { depth }) -> { chain, confidence }
 *
 * Follows ONLY edges of kind 'causes', always the lowest-id outgoing
 * 'causes' edge (deterministic single chain), until a leaf or the
 * depth budget. Revisiting a node on the walk is a cycle -> E_CYCLE.
 *
 * confidence is COMPUTED, not fabricated: 1 / chain.length, i.e. a
 * single fact is certain (1) and each extra hop normalizes the chain
 * weight down, always in [0, 1].
 */
import { fail } from '../_internal.js';

export function causal(graph, from, { depth = Number.MAX_SAFE_INTEGER } = {}) {
  if (!graph.getNode(from)) {
    throw fail('E_UNKNOWN_NODE', `causal start "${from}" is not a node in this graph`);
  }
  if (!Number.isInteger(depth) || depth < 1) {
    throw fail('E_INVALID_DEPTH', `depth must be a positive integer, got ${JSON.stringify(depth)}`);
  }
  const chain = [from];
  const seen = new Set([from]);
  let cur = from;
  while (chain.length < depth) {
    const outs = graph.incident(cur)
      .map((k) => graph.edgesByKey.get(k))
      .filter((e) => e.kind === 'causes' && e.from === cur)
      .map((e) => e.to)
      .sort();
    if (outs.length === 0) break; // leaf: chain terminates, OK
    const next = outs[0];
    if (seen.has(next)) {
      throw fail('E_CYCLE', `causal walk ${chain.join(' -> ')} -> ${next} revisits a node; cycles are not causal chains`);
    }
    seen.add(next);
    chain.push(next);
    cur = next;
  }
  return { chain, confidence: 1 / chain.length };
}

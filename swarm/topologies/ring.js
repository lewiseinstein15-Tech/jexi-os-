/**
 * JEXI OS — Phase 20 Scope A — ring topology.
 *
 * Each node connects to the next member in order; the last member wraps to
 * the first. Exactly n edges for n members. Routing takes the shortest arc
 * of the ring (the deterministic BFS explores both directions and prefers
 * the forward/earlier-index neighbor on ties).
 */
import { assertMembers, pair, router } from './_internal.js';

export const TYPE = 'ring';

export function build(members) {
  assertMembers(members);
  const edges = [];
  for (let i = 0; i < members.length; i += 1) {
    const next = members[(i + 1) % members.length];
    edges.push(pair(members[i], next, 'ring'));
  }
  return { type: TYPE, members: [...members], edges, route: router(members, edges) };
}

export default { TYPE, build };

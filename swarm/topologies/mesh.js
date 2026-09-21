/**
 * JEXI OS — Phase 20 Scope A — mesh topology.
 *
 * Every node connects to every other node. Each undirected pair is emitted
 * once as a single edge (from = the endpoint earlier in `members`), so n
 * members yield n*(n-1)/2 edges; both directions are traversable, and any
 * two members route directly in one hop.
 */
import { assertMembers, pair, router } from './_internal.js';

export const TYPE = 'mesh';

export function build(members) {
  assertMembers(members);
  const edges = [];
  for (let i = 0; i < members.length; i += 1) {
    for (let j = i + 1; j < members.length; j += 1) {
      edges.push(pair(members[i], members[j], 'mesh'));
    }
  }
  return { type: TYPE, members: [...members], edges, route: router(members, edges) };
}

export default { TYPE, build };

/**
 * JEXI OS — Phase 20 Scope A — hierarchical topology.
 *
 * A single root (the first member) fans out one parent-child edge to every
 * other member. Coordination flows through the root: a spoke-to-spoke route
 * is spoke -> root -> spoke. With n members the edge count is exactly n-1.
 */
import { SwarmError, assertMembers, pair, router } from './_internal.js';

export const TYPE = 'hierarchical';

export function build(members) {
  assertMembers(members);
  const root = members[0];
  const edges = [];
  for (let i = 1; i < members.length; i += 1) {
    edges.push(pair(root, members[i], 'parent-child'));
  }
  return { type: TYPE, members: [...members], edges, route: router(members, edges) };
}

export default { TYPE, build };

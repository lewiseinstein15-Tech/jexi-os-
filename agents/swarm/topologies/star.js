/**
 * JEXI OS — Phase 20 Scope A — star topology.
 *
 * One center (the first member); every other member is a spoke with exactly
 * one center-spoke edge. n members -> n-1 edges. Spoke-to-spoke routing
 * always passes through the center.
 */
import { assertMembers, pair, router } from './_internal.js';

export const TYPE = 'star';

export function build(members) {
  assertMembers(members);
  const center = members[0];
  const edges = [];
  for (let i = 1; i < members.length; i += 1) {
    edges.push(pair(center, members[i], 'center-spoke'));
  }
  return { type: TYPE, members: [...members], edges, route: router(members, edges) };
}

export default { TYPE, build };

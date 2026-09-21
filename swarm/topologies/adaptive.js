/**
 * JEXI OS — Phase 20 Scope A — adaptive topology.
 *
 * Chooses a concrete coordination structure from the member count, then
 * builds it for real (edges and router come from the chosen topology —
 * adaptive is a selector, not a fake fifth shape):
 *
 *   n <= 3  -> star          (cheap: one coordinator is enough)
 *   n <= 8  -> hierarchical  (a root coordinating a small team)
 *   n > 8   -> mesh          (many peers, direct peer links win)
 */
import { SwarmError } from './_internal.js';
import hierarchical from './hierarchical.js';
import mesh from './mesh.js';
import star from './star.js';

export const TYPE = 'adaptive';

export const THRESHOLDS = Object.freeze({
  starMax: 3,
  hierarchicalMax: 8,
});

export function strategyFor(count) {
  if (count <= THRESHOLDS.starMax) return 'star';
  if (count <= THRESHOLDS.hierarchicalMax) return 'hierarchical';
  return 'mesh';
}

export function build(members) {
  if (!Array.isArray(members) || members.length < 2) {
    throw new SwarmError('E_TOO_FEW_MEMBERS', `a topology needs at least 2 members, got ${members ? members.length : String(members)}`);
  }
  const strategy = strategyFor(members.length);
  const built = { star, hierarchical, mesh }[strategy].build(members);
  return {
    type: TYPE,
    strategy,
    members: built.members,
    edges: built.edges,
    route: built.route,
  };
}

export default { TYPE, THRESHOLDS, strategyFor, build };

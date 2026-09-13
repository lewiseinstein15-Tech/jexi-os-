/**
 * JEXI OS — WORK GRAPH — replan after a logical failure.
 *
 * A logical failure means the plan itself is wrong. We do NOT retry the
 * failed node: we mark it failed, find the nearest unsuperseded ancestor
 * (mission or strategy), and recompute readiness from there. Descendants of
 * the failed node are set to 'blocked' until a new plan supersedes them.
 */

import { classifyFailure } from './classify.js';

/**
 * @param {object} args
 * @param {import('../nodes/WorkNode.js').WorkNode[]} args.nodes
 * @param {string} args.failedId
 * @param {string} args.reason
 * @returns {{ nearestAncestorId: string|null, blockedDescendants: string[] }}
 */
export function replanFromNearestAncestor({ nodes, failedId, reason }) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const failed = byId.get(failedId);
  if (!failed) return { nearestAncestorId: null, blockedDescendants: [] };

  // nearest ancestor = the closest node in the transitive dependency chain
  // that is itself a strategy/mission (the decision point). Walk up.
  let ancestorId = null;
  const walk = (nodeId, seen) => {
    if (seen.has(nodeId)) return;
    seen.add(nodeId);
    const n = byId.get(nodeId);
    if (!n) return;
    if ((n.type === 'strategy' || n.type === 'mission') && n.id !== failedId) {
      ancestorId = n.id;
      return;
    }
    for (const dep of n.dependencies) walk(dep, seen);
  };
  walk(failedId, new Set());

  // descendants that depended on the failed node can no longer run as-is
  const blocked = [];
  for (const n of nodes) {
    if (n.id === failedId) continue;
    const chain = (id, seen) => {
      if (seen.has(id)) return false;
      seen.add(id);
      const cur = byId.get(id);
      if (!cur) return false;
      if (cur.dependencies.includes(failedId)) return true;
      return cur.dependencies.some((d) => chain(d, seen));
    };
    if (chain(n.id, new Set())) blocked.push(n.id);
  }

  const verdict = classifyFailure({ class: '', reason });
  return { nearestAncestorId: ancestorId, blockedDescendants: blocked, verdict };
}
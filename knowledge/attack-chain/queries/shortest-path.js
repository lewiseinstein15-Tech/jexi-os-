/**
 * JEXI OS — Phase 8 Scope C — QUERY: shortest-path.
 *
 * Shortest escalation / attack path between any two nodes (any entity type)
 * using exactly the attack-paths traversal model and determinism rules.
 * Returns the first shortest path in the deterministic ordering plus how
 * many alternatives were evaluated.
 */

import { attackPaths } from './attack-paths.js';

export function shortestPath(graph, { fromType, fromId, toType, toId } = {}) {
  const res = attackPaths(graph, { fromType, fromId, toType, toId });
  return {
    from: res.from,
    to: res.to,
    found: res.pathCount > 0,
    hops: res.pathCount > 0 ? res.paths[0].hops : null,
    path: res.pathCount > 0 ? res.paths[0] : null,
    shortestPathCount: res.pathCount,
    alternativesEvaluated: res.pathCount,
  };
}

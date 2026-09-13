/**
 * JEXI OS — WORK GRAPH — blocks edge.
 *
 * A BLOCKS edge keeps a node in 'blocked' status until the blocking node is
 * cancelled/superseded/failed (never while the blocker is merely running).
 * The graph tracks a separate `blocks` adjacency list.
 */

/** Keys stored per node (side table kept inside checkpoint nodes). */
export const BLOCKS_KEY = '$blocks';

export function blocksOf(node, graph = {}) {
  return graph[BLOCKS_KEY]?.[node.id] ?? [];
}

export function addBlocks(graph, blockerId, blockedId) {
  const adj = (graph[BLOCKS_KEY] ??= {});
  (adj[blockerId] ??= []).push(blockedId);
  return graph;
}
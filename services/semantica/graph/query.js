/**
 * JEXI OS — Phase 14 Scope A — lookup + traversal over the graph.
 *
 * query(): filter nodes by kind and/or exact label and/or props match;
 * result sorted by id.
 *
 * traverse(): real BFS over exactly the stored edges (followed in
 * either direction — a context link is reachable both ways), bounded
 * by depth, optionally restricted to edgeKinds. Returns the visited
 * set INCLUDING the start node, sorted by id. Unknown start node ->
 * E_UNKNOWN_NODE. No invented shortcuts: a node is visited only when
 * a stored edge chain of length <= depth reaches it.
 */
import { fail, byId } from '../_internal.js';

function propsMatch(node, prop) {
  for (const [k, v] of Object.entries(prop)) {
    if (node.props[k] !== v) return false;
  }
  return true;
}

export function query(graph, { kind, label, prop } = {}) {
  let out = graph.nodes();
  if (kind !== undefined) out = out.filter((n) => n.kind === kind);
  if (label !== undefined) out = out.filter((n) => n.label === label);
  if (prop !== undefined) {
    if (typeof prop !== 'object' || prop === null || Array.isArray(prop)) {
      throw fail('E_INVALID_QUERY', 'prop filter must be an object of exact props matches');
    }
    out = out.filter((n) => propsMatch(n, prop));
  }
  return out.sort(byId);
}

export function traverse(graph, from, { depth = 1, edgeKinds } = {}) {
  if (!graph.getNode(from)) {
    throw fail('E_UNKNOWN_NODE', `traverse start "${from}" is not a node in this graph`);
  }
  if (!Number.isInteger(depth) || depth < 0) {
    throw fail('E_INVALID_DEPTH', `depth must be a non-negative integer, got ${JSON.stringify(depth)}`);
  }
  const kinds = edgeKinds !== undefined ? new Set(edgeKinds) : null;
  const visited = new Set([from]);
  let frontier = [from];
  for (let d = 0; d < depth; d += 1) {
    const next = [];
    for (const id of [...frontier].sort(byId)) {
      // walk incident edges in sorted key order for determinism
      for (const key of graph.incident(id)) {
        const edge = edgeOf(graph, key);
        if (kinds && !kinds.has(edge.kind)) continue;
        const other = edge.from === id ? edge.to : edge.from;
        if (!visited.has(other)) {
          visited.add(other);
          next.push(other);
        }
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }
  return [...visited].map((id) => graph.getNode(id)).sort(byId);
}

/** Resolve an edge key back to its edge record via the store's map. */
function edgeOf(graph, key) {
  return graph.edgesByKey.get(key);
}

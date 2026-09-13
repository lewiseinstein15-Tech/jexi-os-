/**
 * JEXI OS — WORK GRAPH — depends_on edge.
 *
 * A node is 'ready' only when every `depends_on` target is 'completed'.
 * targets are stored directly on the node's `dependencies` array.
 */

/** All nodes a node depends on. */
export function dependsOn(node) {
  return node.dependencies ?? [];
}

/**
 * Add a depends_on edge (a → b after b completes).
 * @param {import('../nodes/WorkNode.js').WorkNode} a
 * @param {import('../nodes/WorkNode.js').WorkNode} b
 */
export function addDependsOn(a, b) {
  if (!a.dependencies.includes(b.id)) a.dependencies.push(b.id);
  return a;
}
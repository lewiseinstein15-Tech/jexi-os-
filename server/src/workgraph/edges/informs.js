/**
 * JEXI OS — WORK GRAPH — informs edge.
 *
 * NOT a hard dependency: an informs edge carries a reference (for evidence /
 * context) but does NOT block readiness. A node whose only connection to
 * another is `informs` may run as soon as its real dependencies are met.
 */

export function addInforms(node, informedId) {
  node.dependencies = node.dependencies ?? [];
  node.informs = node.informs ?? [];
  if (!node.informs.includes(informedId)) node.informs.push(informedId);
  return node;
}

export function informsOf(node) {
  return node.informs ?? [];
}
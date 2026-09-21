/**
 * JEXI OS — Phase 14 Scope A — context graph entry point.
 *
 *   import { graph } from './semantica/graph/index.js';
 *   const g = graph.create();
 */
import { create, Graph } from './store.js';

export const graph = { create };
export { Graph };
export { NODE_KINDS, makeNode } from './nodes.js';
export { makeEdge, edgeKey } from './edges.js';
export { query, traverse } from './query.js';
export { SemanticaError } from '../_internal.js';

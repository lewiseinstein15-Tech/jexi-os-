// CBM tool — get-graph-schema: node/edge schema, counts, relationship patterns.
import { defineTool } from '../../../server/src/tools/interface/ToolDefinition.js';
import { getStore } from './_graph.js';
import { NODE_LABELS } from '../../../capability/code/graph/nodes/index.js';
import { EDGE_TYPES } from '../../../capability/code/graph/edges/index.js';

export const def = defineTool({
  name: 'get-graph-schema',
  description: 'Return the graph schema: node labels with property definitions, edge types, counts, and observed relationship patterns.',
  parameters: {
    type: 'object',
    properties: { project: { type: 'string' } },
    required: [],
    additionalProperties: false,
  },
  returns: { type: 'object', description: '{ ok, backend, nodeLabels, edgeTypes, counts, relationshipPatterns }' },
  riskLevel: 'low',
  runtimeRing: 2,
  sideEffects: [],
  idempotent: true,
  failureTypes: ['tool_error'],
});

const NODE_PROPS = {
  Function: ['name', 'qualname', 'file', 'line', 'endLine', 'language', 'props{kind,owner,params}'],
  Class: ['name', 'qualname', 'file', 'line', 'endLine', 'language', 'props{superclass}'],
  File: ['name', 'qualname', 'file', 'language', 'props{bytes}'],
  Route: ['name', 'qualname', 'file', 'line', 'props{method,path}'],
  Resource: ['name', 'qualname', 'file', 'language', 'props{kind,identifier}'],
  Module: ['name', 'qualname', 'props{kind}'],
};

export async function handler(args = {}) {
  const project = String(args.project || 'jexi-os');
  const store = await getStore();
  const byId = new Map(store.nodes(project).map((n) => [n.id, n]));
  const patterns = {};
  for (const e of store.edges(project)) {
    const a = byId.get(e.src);
    const b = byId.get(e.dst);
    if (!a || !b) continue;
    const key = `(:${a.label})-[:${e.type}]->(:${b.label})`;
    patterns[key] = (patterns[key] || 0) + 1;
  }
  return {
    ok: true,
    backend: store.backend,
    nodeLabels: NODE_LABELS,
    nodePropertyDefinitions: NODE_PROPS,
    edgeTypes: EDGE_TYPES,
    counts: { nodes: store.counts(project), edges: store.edgeCounts(project) },
    relationshipPatterns: Object.fromEntries(Object.entries(patterns).sort((x, y) => y[1] - x[1])),
  };
}

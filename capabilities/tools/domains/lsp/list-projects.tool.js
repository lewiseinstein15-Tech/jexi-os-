// CBM tool — list-projects: all indexed projects with node/edge counts.
import { defineTool } from '../../../server/src/tools/interface/ToolDefinition.js';
import { getStore } from './_graph.js';

export const def = defineTool({
  name: 'list-projects',
  description: 'List every indexed project in the graph store with node and edge counts and last-index time.',
  parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
  returns: { type: 'object', description: '{ ok, projects: [{ project, nodes, edges, indexedAt }], backend }' },
  riskLevel: 'low',
  runtimeRing: 2,
  sideEffects: [],
  idempotent: true,
  failureTypes: ['tool_error'],
});

export async function handler() {
  const store = await getStore();
  const projects = store.listProjects().map((p) => ({
    ...p,
    indexedAt: store.getMeta(`${p.project}:indexedAt`) || null,
  }));
  return { ok: true, backend: store.backend, projects };
}

// CBM tool — delete-project: remove a project and all its graph data.
import { defineTool } from '../../../server/src/tools/interface/ToolDefinition.js';
import { getStore, ToolInputError } from './_graph.js';

export const def = defineTool({
  name: 'delete-project',
  description: 'Permanently remove a project and all of its graph nodes/edges from the store (destructive, requires confirm).',
  parameters: {
    type: 'object',
    properties: {
      project: { type: 'string', description: 'Project name to delete.' },
      confirm: { type: 'boolean', description: 'Must be exactly true — safety confirmation.' },
    },
    required: ['project', 'confirm'],
    additionalProperties: false,
  },
  returns: { type: 'object', description: '{ ok, project, removedNodes, removedEdges, remainingProjects }' },
  riskLevel: 'high',
  runtimeRing: 2,
  sideEffects: ['graph-db-destructive'],
  idempotent: true,
  failureTypes: ['tool_error'],
});

export async function handler(args = {}) {
  if (args.confirm !== true) {
    throw new ToolInputError('CONFIRMATION_REQUIRED', 'delete-project requires confirm:true — refusing to delete without explicit confirmation');
  }
  const project = String(args.project || '');
  if (!project) throw new ToolInputError('PROJECT_REQUIRED', 'project name is required');
  const store = await getStore();
  const before = store.listProjects().find((p) => p.project === project);
  if (!before) {
    throw new ToolInputError('PROJECT_NOT_FOUND', `project "${project}" does not exist in the store (have: ${store.listProjects().map((p) => p.project).join(', ') || 'none'})`);
  }
  store.reset(project);
  store.flush();
  return {
    ok: true,
    project,
    removedNodes: before.nodes,
    removedEdges: before.edges,
    remainingProjects: store.listProjects().map((p) => p.project),
  };
}

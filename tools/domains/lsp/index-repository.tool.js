// CBM tool — index-repository: index a repository into the knowledge graph.
import path from 'node:path';
import { defineTool } from '../../../server/src/tools/interface/ToolDefinition.js';
import { repoRoot, getStore, ToolInputError } from './_graph.js';
import { indexRepository } from '../../../capability/code/graph/index.js';

export const def = defineTool({
  name: 'index-repository',
  description: 'Index a repository into the persistent code knowledge graph (nodes + edges) and return index statistics.',
  parameters: {
    type: 'object',
    properties: {
      root: { type: 'string', description: 'Absolute repository path (defaults to this repo).' },
      project: { type: 'string', description: 'Project name to index under (defaults to the repo basename).' },
      fresh: { type: 'boolean', description: 'Wipe the project graph before indexing (default true).' },
    },
    required: [],
    additionalProperties: false,
  },
  returns: { type: 'object', description: '{ project, backend, nodes, edges, nodesByLabel, edgesByType, durationMs }' },
  riskLevel: 'medium',
  runtimeRing: 2,
  sideEffects: ['graph-db'],
  idempotent: true,
  failureTypes: ['tool_error'],
});

export async function handler(args = {}) {
  const root = repoRoot(args.root);
  const project = String(args.project || path.basename(root));
  const store = await getStore();
  const stats = await indexRepository({ root, store, project, fresh: args.fresh !== false });
  return { ok: true, ...stats };
}

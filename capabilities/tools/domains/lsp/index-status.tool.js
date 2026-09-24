// CBM tool — index-status: indexing status for one project.
import { defineTool } from '../../../server/src/tools/interface/ToolDefinition.js';
import { getStore, ToolInputError } from './_graph.js';

export const def = defineTool({
  name: 'index-status',
  description: 'Report indexing status for a project: backend, freshness timestamp, node/edge totals and label/type breakdown.',
  parameters: {
    type: 'object',
    properties: { project: { type: 'string', description: 'Project name (defaults to this repo).' } },
    required: [],
    additionalProperties: false,
  },
  returns: { type: 'object', description: '{ ok, project, indexed, indexedAt, backend, nodes, edges, stats }' },
  riskLevel: 'low',
  runtimeRing: 2,
  sideEffects: [],
  idempotent: true,
  failureTypes: ['tool_error'],
});

export async function handler(args = {}) {
  const project = String(args.project || 'jexi-os');
  const store = await getStore();
  const indexedAt = store.getMeta(`${project}:indexedAt`);
  if (!indexedAt) {
    throw new ToolInputError('PROJECT_NOT_INDEXED', `project "${project}" has never been indexed (run index-repository first)`);
  }
  const n = store.counts(project);
  const e = store.edgeCounts(project);
  let stats = null;
  try { stats = JSON.parse(store.getMeta(`${project}:stats`) || 'null'); } catch { stats = null; }
  return {
    ok: true,
    project,
    indexed: true,
    indexedAt,
    backend: store.backend,
    nodes: n.total,
    nodesByLabel: n.byLabel,
    edges: e.total,
    edgesByType: e.byType,
    stats: stats ? { sourceFilesIndexed: stats.sourceFilesIndexed, callsResolved: stats.callsResolved, durationMs: stats.durationMs } : null,
  };
}

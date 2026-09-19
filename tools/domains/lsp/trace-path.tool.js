// CBM tool — trace-path: BFS call-chain traversal (who calls / what is called).
import { defineTool } from '../../../server/src/tools/interface/ToolDefinition.js';
import { getStore, ToolInputError } from './_graph.js';

export const def = defineTool({
  name: 'trace-path',
  description: 'BFS traversal over CALLS edges: who calls a function and what it calls, to a depth of 1-5.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Function/class name to trace from (exact name; use search-graph to discover).' },
      direction: { type: 'string', enum: ['in', 'out', 'both'] },
      depth: { type: 'number', minimum: 1, maximum: 5 },
      limit: { type: 'number', minimum: 1, maximum: 100 },
      project: { type: 'string' },
    },
    required: ['name'],
    additionalProperties: false,
  },
  returns: { type: 'object', description: '{ ok, roots, chains: [{ path: [label:name…], edges: [CALLS…] }] }' },
  riskLevel: 'low',
  runtimeRing: 2,
  sideEffects: [],
  idempotent: true,
  failureTypes: ['tool_error'],
});

export async function handler(args = {}) {
  const name = String(args.name || '');
  if (!name) throw new ToolInputError('NAME_REQUIRED', 'name is required (exact symbol name — use search-graph first)');
  const depth = args.depth == null ? 2 : Number(args.depth);
  if (!Number.isInteger(depth) || depth < 1 || depth > 5) {
    throw new ToolInputError('DEPTH_OUT_OF_RANGE', `depth must be an integer 1-5 (got ${args.depth})`);
  }
  const store = await getStore();
  const r = store.tracePath({
    project: String(args.project || 'jexi-os'),
    name,
    direction: args.direction || 'out',
    depth,
    limit: Math.min(args.limit || 12, 100),
  });
  if (r.roots.length === 0) {
    throw new ToolInputError('SYMBOL_NOT_FOUND', `no node named "${name}" in project graph — run search-graph to discover exact names`);
  }
  return { ok: true, roots: r.roots, chains: r.paths };
}

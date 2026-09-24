// CBM tool — search-graph: structural search over node names (regex, label filter).
import { defineTool } from '../../../server/src/tools/interface/ToolDefinition.js';
import { getStore, ToolInputError } from './_graph.js';

export const def = defineTool({
  name: 'search-graph',
  description: 'Search graph nodes by name (case-insensitive regex) with optional label filter — the structural search entry point.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Name pattern (case-insensitive regex).' },
      label: { type: 'string', enum: ['Function', 'Class', 'File', 'Route', 'Resource', 'Module'] },
      limit: { type: 'number', minimum: 1, maximum: 100 },
      offset: { type: 'number', minimum: 0 },
      project: { type: 'string' },
    },
    required: ['name'],
    additionalProperties: false,
  },
  returns: { type: 'object', description: '{ ok, total, rows: [{ label, name, qualname, file, line }] }' },
  riskLevel: 'low',
  runtimeRing: 2,
  sideEffects: [],
  idempotent: true,
  failureTypes: ['tool_error'],
});

export async function handler(args = {}) {
  const name = String(args.name || '');
  if (!name) throw new ToolInputError('NAME_REQUIRED', 'name pattern is required');
  let re;
  try {
    re = new RegExp(name, 'i');
  } catch (err) {
    throw new ToolInputError('INVALID_REGEX', `name pattern is not a valid regex: ${err.message}`);
  }
  void re; // validation only — store compiles its own
  const store = await getStore();
  const r = store.searchGraph({
    project: String(args.project || 'jexi-os'),
    namePattern: name,
    label: args.label || null,
    limit: Math.min(args.limit || 20, 100),
    offset: args.offset || 0,
  });
  return {
    ok: true,
    total: r.total,
    rows: r.rows.map((n) => ({ label: n.label, name: n.name, qualname: n.qualname, file: n.file, line: n.line })),
  };
}

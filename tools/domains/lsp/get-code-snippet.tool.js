// CBM tool — get-code-snippet: real source body of a symbol by qualified name.
import fs from 'node:fs';
import path from 'node:path';
import { defineTool } from '../../../server/src/tools/interface/ToolDefinition.js';
import { repoRoot, getStore, ToolInputError } from './_graph.js';

export const def = defineTool({
  name: 'get-code-snippet',
  description: 'Read the real source lines of a graph symbol by qualified name (<file>::<name>), with optional context lines.',
  parameters: {
    type: 'object',
    properties: {
      qualname: { type: 'string', description: 'Exact qualified name, e.g. capability/code/graph/store.js::openGraphStore' },
      contextLines: { type: 'number', minimum: 0, maximum: 20 },
      project: { type: 'string' },
    },
    required: ['qualname'],
    additionalProperties: false,
  },
  returns: { type: 'object', description: '{ ok, qualname, file, startLine, endLine, snippet }' },
  riskLevel: 'low',
  runtimeRing: 2,
  sideEffects: [],
  idempotent: true,
  failureTypes: ['tool_error'],
});

export async function handler(args = {}) {
  const qualname = String(args.qualname || '');
  if (!qualname.includes('::')) {
    throw new ToolInputError('MALFORMED_QUALNAME', `qualname must look like <file>::<name> (got "${qualname}") — discover via search-graph`);
  }
  const store = await getStore();
  const project = String(args.project || 'jexi-os');
  const node = store.getByQualname
    ? store.getByQualname(qualname, project)
    : store.searchGraph({ project, namePattern: `^${qualname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, limit: 1 }).rows[0] || null;
  if (!node) {
    const close = store.searchGraph({ project, namePattern: qualname.split('::').pop(), limit: 5 });
    throw new ToolInputError('SYMBOL_NOT_FOUND', `no node with qualname "${qualname}" (close matches: ${close.rows.map((r) => r.qualname).join(', ') || 'none'})`);
  }
  if (!node.file) throw new ToolInputError('NO_SOURCE_LOCATION', `node "${qualname}" has no source file (label ${node.label})`);
  const root = repoRoot();
  const abs = path.join(root, node.file);
  if (!fs.existsSync(abs)) throw new ToolInputError('SOURCE_FILE_GONE', `source file missing on disk: ${node.file}`);
  const lines = fs.readFileSync(abs, 'utf8').split('\n');
  const ctx = args.contextLines == null ? 2 : Number(args.contextLines);
  const startLine = Math.max(1, (node.line || 1) - ctx);
  const endLine = Math.min(lines.length, (node.endLine || node.line || 1) + ctx);
  return {
    ok: true,
    qualname: node.qualname,
    label: node.label,
    file: node.file,
    startLine,
    endLine,
    snippet: lines.slice(startLine - 1, endLine).join('\n'),
  };
}

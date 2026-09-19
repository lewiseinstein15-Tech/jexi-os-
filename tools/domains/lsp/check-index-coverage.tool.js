// CBM tool — check-index-coverage: how much of the repo the graph actually covers.
import { defineTool } from '../../../server/src/tools/interface/ToolDefinition.js';
import { repoRoot, getStore, walkSourceFiles } from './_graph.js';

export const def = defineTool({
  name: 'check-index-coverage',
  description: 'Compute real index coverage: indexed source files vs all source files on disk, with the missing list.',
  parameters: {
    type: 'object',
    properties: {
      root: { type: 'string' },
      project: { type: 'string' },
      showMissing: { type: 'boolean', description: 'Include up to 15 missing file paths in the result (default true).' },
    },
    required: [],
    additionalProperties: false,
  },
  returns: { type: 'object', description: '{ ok, coveragePct, indexedFiles, diskSourceFiles, missingCount, missing[] }' },
  riskLevel: 'low',
  runtimeRing: 2,
  sideEffects: [],
  idempotent: true,
  failureTypes: ['tool_error'],
});

export async function handler(args = {}) {
  const root = repoRoot(args.root);
  const project = String(args.project || 'jexi-os');
  const store = await getStore();
  const diskFiles = walkSourceFiles(root);
  const diskSet = new Set(diskFiles);
  const fileNodes = store.nodes(project).filter((n) => n.label === 'File' && n.file && diskSet.has(n.file));
  const indexedSet = new Set(fileNodes.map((n) => n.file));
  const missing = diskFiles.filter((f) => !indexedSet.has(f));
  const coveragePct = diskFiles.length === 0 ? 0 : Math.round((indexedSet.size / diskFiles.length) * 1000) / 10;
  return {
    ok: true,
    project,
    backend: store.backend,
    coveragePct,
    indexedFiles: indexedSet.size,
    diskSourceFiles: diskFiles.length,
    missingCount: missing.length,
    missing: args.showMissing === false ? undefined : missing.slice(0, 15),
  };
}

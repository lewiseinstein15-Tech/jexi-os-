// CBM tool — get-architecture: codebase overview from the graph.
import { defineTool } from '../../../server/src/tools/interface/ToolDefinition.js';
import { getStore } from './_graph.js';

export const def = defineTool({
  name: 'get-architecture',
  description: 'Codebase overview from the graph: languages, packages (top-level dirs), routes, hotspot symbols, service clusters, ADR count.',
  parameters: {
    type: 'object',
    properties: { project: { type: 'string' } },
    required: [],
    additionalProperties: false,
  },
  returns: { type: 'object', description: '{ ok, languages, packages, routes, hotspots, clusters, adrCount }' },
  riskLevel: 'low',
  runtimeRing: 2,
  sideEffects: [],
  idempotent: true,
  failureTypes: ['tool_error'],
});

export async function handler(args = {}) {
  const project = String(args.project || 'jexi-os');
  const store = await getStore();
  const nodes = store.nodes(project);
  const files = nodes.filter((n) => n.label === 'File' && n.file);
  const languages = {};
  for (const f of files) languages[f.language || 'unk'] = (languages[f.language || 'unk'] || 0) + 1;
  const packages = {};
  for (const f of files) {
    const top = f.file.includes('/') ? f.file.split('/')[0] : '(root)';
    packages[top] = (packages[top] || 0) + 1;
  }
  const routes = nodes.filter((n) => n.label === 'Route').map((r) => ({ name: r.name, file: r.file, line: r.line })).slice(0, 25);

  const inDeg = new Map();
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const e of store.edges(project)) {
    if (e.type !== 'CALLS') continue;
    inDeg.set(e.dst, (inDeg.get(e.dst) || 0) + 1);
  }
  const hotspots = [...inDeg.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([id, deg]) => {
      const n = byId.get(id);
      return n ? { symbol: n.qualname, label: n.label, fanIn: deg } : null;
    })
    .filter(Boolean);

  const clusters = {};
  for (const f of files) {
    const top = f.file.includes('/') ? f.file.split('/')[0] : '(root)';
    clusters[top] = (clusters[top] || 0) + 1;
  }

  const adrs = store.listProjects && typeof store.getMeta === 'function'
    ? countAdrs(store, project)
    : 0;

  return {
    ok: true,
    project,
    backend: store.backend,
    languages,
    packages: Object.fromEntries(Object.entries(packages).sort((a, b) => b[1] - a[1])),
    routes,
    hotspots,
    clusters,
    adrCount: adrs,
  };
}

function countAdrs(store, project) {
  // ADRs live under meta key `adr:<project>:<id>` (see manage-adr).
  let n = 0;
  if (store.data && store.data.meta) {
    n = Object.keys(store.data.meta).filter((k) => k.startsWith(`adr:${project}:`)).length;
    return n;
  }
  // SQLite backend: meta table has no scan API — report the indexed count marker if present.
  return store.getMeta(`adr:${project}:count`) ? Number(store.getMeta(`adr:${project}:count`)) : 0;
}

#!/usr/bin/env node
// Phase 11 Scope B — run all 15 CBM tools through the REAL dispatcher:
// registerCbmTools → real ToolRegistry → makeExecutor (schema → permission →
// risk → engine) — the same pipeline runToolCalls/domainDispatch use.

import { registerCbmTools, CBM_TOOL_NAMES, allRegistered } from '../capabilities/tools/domains/lsp/index.js';
import { registerAllDomains } from '../server/src/tools/domains/index.js';
import { makeExecutor } from '../server/src/tools/index.js';
import { hasTool, getTool, validateCall } from '../server/src/tools/registry/ToolRegistry.js';
import { closeStore } from '../capabilities/tools/domains/lsp/_graph.js';

const argc = process.argv.slice(2);
const ONLY = argc[0] || null;

const cbm = registerCbmTools();
const domains = registerAllDomains({ ...cbm.engines }); // extras seam: CBM joins the full catalog
const executor = makeExecutor({ engines: domains.engines, permissions: { allowAll: true }, risk: { sandboxRing: 'host' } });

console.log('═══ registration (real ToolRegistry) ═══');
console.log('registered:', CBM_TOOL_NAMES.length, 'CBM tools | allRegistered():', allRegistered());
for (const name of CBM_TOOL_NAMES) {
  const d = getTool(name);
  console.log(`  ${hasTool(name) ? '✅' : '❌'} ${name} | risk=${d?.riskLevel} | params=${Object.keys(d?.parameters?.properties || {}).join(',') || '∅'}`);
}
const regLine = (await import('node:fs')).readFileSync(new URL('../capabilities/tools/domains/lsp/index.js', import.meta.url), 'utf8')
  .split('\n').findIndex((l) => l.includes('registerToolBatch(defs)')) + 1;
console.log(`registration file:line → tools/domains/lsp/index.js:${regLine} (registerToolBatch(defs))`);

async function dispatch(name, args) {
  const call = { id: `${name}-${Date.now().toString(36)}`, name, arguments: args ?? {} };
  const v = validateCall(call);
  if (!v.valid) return { VALIDATION_ERROR: v.errors };
  const r = await executor.execute(call, { root: process.cwd() });
  return r;
}
function show(tag, result) {
  const s = JSON.stringify(result);
  console.log(`\n─── ${tag} ───`);
  console.log(s.length > 1400 ? `${s.slice(0, 1400)}…(+${s.length - 1400} chars truncated)` : s);
}

const P = {
  'P1': ['index-repository', {}],
  'P2': ['list-projects', {}],
  'P3': ['index-status', {}],
  'P4': ['check-index-coverage', {}],
  'P5': ['search-graph', { name: 'indexRepository', limit: 5 }],
  'P6': ['search-code', { query: 'harvestMemberCalls', maxResults: 5 }],
  'P7': ['trace-path', { name: 'readSkill', direction: 'in', depth: 1 }],
  'P8': ['get-architecture', {}],
  'P9': ['get-graph-schema', {}],
  'P10': ['get-code-snippet', { qualname: 'capability/code/graph/store.js::openGraphStore', contextLines: 1 }],
  'P11a': ['manage-adr', { mode: 'create', title: 'Use code knowledge graph before file reads', body: '# ADR-0001\n\n## Context\nAgents burn tokens reading whole files.\n\n## Decision\nGraph-first queries via CBM tools.\n\n## Consequences\nToken savings, fresher index required.' }],
  'P11b': ['manage-adr', { mode: 'set_sections', id: 'adr-0001', sections: { Consequences: 'Token savings; index freshness is now a hard dependency.' } }],
  'P11c': ['manage-adr', { mode: 'get', id: 'adr-0001' }],
  'P12': ['query-graph', { query: "MATCH (n:Function)-[:CALLS]->(m:Class) RETURN n.name, m.name LIMIT 5" }],
  'P13': ['detect-changes', { ref: 'HEAD~1' }],
  'P14': ['ingest-traces', { traces: [
    { caller: 'cmdDoctor', endpoint: 'https://wttr.in/Berlin?format=3', method: 'GET', status: 200 },
    { caller: 'nonexistentSymbol', endpoint: 'https://definitely-not-in-graph.example.com/x' },
  ] }],
  'P15a': ['index-repository', { project: 'temp-probe', root: null }],
  'P15b': ['delete-project', { project: 'temp-probe', confirm: true }],
  'P15c': ['list-projects', {}],
  'ERR1': ['search-graph', { name: '(' }],
  'ERR2': ['delete-project', { project: 'jexi-os' }],
};

const plan = ONLY ? Object.fromEntries(Object.entries(P).filter(([k]) => k === ONLY || (ONLY === 'P11' && k.startsWith('P11')) || (ONLY === 'P15' && k.startsWith('P15')))) : P;

for (const [tag, planEntry] of Object.entries(plan)) {
  let [name, args] = planEntry;
  if (tag === 'P15a') {
    // temp project on a fixture dir (2 tiny files), NOT the whole repo twice
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cbm-probe-'));
    fs.writeFileSync(path.join(tmp, 'a.js'), 'export function probeAlpha(){ return beta(); }\nfunction beta(){ return 1; }\n');
    fs.writeFileSync(path.join(tmp, 'b.js'), 'import { probeAlpha } from "./a.js";\nexport const run = () => probeAlpha();\n');
    args = { project: 'temp-probe', root: tmp };
    show(`${tag} ${name} ${JSON.stringify(args).slice(0, 60)}`, await dispatch(name, args));
    continue;
  }
  show(`${tag} ${name} ${JSON.stringify(args).length > 80 ? JSON.stringify(args).slice(0, 80) + '…' : JSON.stringify(args)}`, await dispatch(name, args));
}

await closeStore();

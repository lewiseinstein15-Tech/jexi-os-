#!/usr/bin/env node
// Phase 11 Scope A — live probes against the code knowledge graph.
// Usage: node scripts/phase11-probe-a.mjs <counts|search|trace|backend|postrestart> [--db DIR] [--project NAME] [--name SYMBOL]

import path from 'node:path';
import { execSync } from 'node:child_process';
import { openGraphStore, probeSqlite } from '../capabilities/graph/code/graph/store.js';

const args = process.argv.slice(2);
const cmd = args[0];
const arg = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const root = path.resolve(execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim());
const db = path.resolve(arg('db') || path.join(root, 'capability/code/graph/db'));
const project = arg('project', path.basename(root));

if (cmd === 'backend') {
  const probe = await probeSqlite();
  console.log(JSON.stringify({ node: process.version, sqliteAvailable: probe.ok, sqliteReason: probe.reason }, null, 2));
  const store = await openGraphStore(db, { project });
  console.log('active backend:', store.backend);
  store.close();
  process.exit(0);
}

const store = await openGraphStore(db, { project });

if (cmd === 'counts') {
  const n = store.counts(project);
  const e = store.edgeCounts(project);
  console.log('P1 — node count:      ', n.total);
  console.log('P1 — edge count:      ', e.total);
  console.log('P1 — nodes by type:   ', JSON.stringify(n.byLabel));
  console.log('P1 — edges by type:   ', JSON.stringify(e.byType));
} else if (cmd === 'search') {
  const name = arg('name', 'HybridLsp');
  const r = store.searchGraph({ project, namePattern: name, limit: 8 });
  console.log(`P2 — search_graph(name~${name}) → ${r.total} match(es)`);
  for (const row of r.rows) {
    console.log(`   [${row.label}] ${row.qualname}  (${row.file}:${row.line})`);
  }
} else if (cmd === 'trace') {
  const name = arg('name', 'indexRepository');
  const direction = arg('direction', 'out');
  const depth = Number(arg('depth', '3'));
  const r = store.tracePath({ project, name, direction, depth, limit: 12 });
  console.log(`P3 — trace_path(${name}, direction=${direction}, depth=${depth}) → ${r.paths.length} chain(s)`);
  for (const p of r.paths.slice(0, 8)) {
    console.log('   ' + p.path.map((n) => `${n.label}:${n.name}`).join('  →  ') + (p.edges.length ? `   [${p.edges.join(', ')}]` : ''));
  }
} else if (cmd === 'postrestart') {
  const n = store.counts(project);
  const e = store.edgeCounts(project);
  const s = store.searchGraph({ project, namePattern: 'GraphStore', limit: 5 });
  console.log(`P4 — fresh process → nodes=${n.total} edges=${e.total} (intact: ${n.total > 0 ? 'YES' : 'NO'})`);
  console.log(`P4 — spot-check search_graph(GraphStore) → ${s.total} match(es)`);
  for (const row of s.rows) console.log(`   [${row.label}] ${row.qualname}`);
} else {
  console.error('unknown subcommand; use counts|search|trace|backend|postrestart');
  process.exit(1);
}
store.close();

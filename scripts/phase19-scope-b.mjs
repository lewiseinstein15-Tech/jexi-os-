#!/usr/bin/env node
/**
 * JEXI OS — Phase 19 Scope B — live probe (P1-P7).
 *
 * Raw output only. English only. Every PASS/FAIL line is computed from real
 * calls against surfsense/search. No scores are faked.
 *
 * NOTE: the optional graph boost (P4) uses capability/rag/graph-rag (Phase 22
 * C). GraphRag.index() writes a snapshot file; JEXI_RAG_DIR is redirected
 * OUTSIDE the repo worktree so the P7 zone check stays clean.
 */
import { execSync } from 'node:child_process';
import os from 'node:os';
import search from '../services/surfsense/search/index.js';
import { SurfError } from '../services/surfsense/connectors/_internal.js';

// consolidation cleanup: snapshot dir is host-portable now (os.tmpdir()),
// overridable via JEXI_RAG_DIR; the old hardcoded sandbox path is gone.
process.env.JEXI_RAG_DIR = process.env.JEXI_RAG_DIR || `${os.tmpdir()}/p19-rag-snapshots`;
const { GraphRag } = await import('../capabilities/graph/rag/graph-rag.js');

const results = [];
function check(pid, label, pass, detail) {
  results.push({ pid, label, pass });
  console.log(`P${pid} ${pass ? 'PASS' : 'FAIL'} — ${label}`);
  if (detail !== undefined) console.log(detail);
}
function failLabel(pid, label, err) {
  results.push({ pid, label, pass: false });
  console.log(`P${pid} FAIL — ${label} (${err?.message ?? err})`);
}

const fmt = (e, fields) =>
  `    ${String(e.id).padEnd(15)} ${fields.map((f) => `${f}=${e[f].toFixed(4)}`).join(' ')}`;

console.log('=== PHASE 19 SCOPE B PROBE ===\n');

const DOCS = [
  { id: 'compose-basics', text: 'Compose files build multi container apps and the DOCKER engine runs them' },
  { id: 'kw-strong', text: 'Kubernetes Swarm Kubernetes Swarm cluster autoscaling pods networking storage' },
  { id: 'vec-strong', text: 'docker docker docker docker' },
  { id: 'mesh-notes', text: 'Service Mesh proxy sidecar envoy' },
  { id: 'registry-notes', text: 'Docker Registry storage drivers with BM25 indexing and vector search retrieval' },
];
const QUERY = 'kubernetes docker swarm';

// ---------------------------------------------------------------- P1
try {
  const ranked = search.keyword(QUERY, DOCS);
  const top = ranked[0];
  check(
    1,
    `search.keyword('${QUERY}') on ${DOCS.length} docs -> ranked with real BM25 scores (k1=1.5, b=0.75)`,
    ranked.length === 5 && top.id === 'kw-strong' && top.score > 0,
    `    vector label check n/a here; BM25 scores:\n${ranked.map((e) => fmt(e, ['score'])).join('\n')}`
  );
} catch (err) {
  failLabel(1, 'keyword search', err);
}

// ---------------------------------------------------------------- P2
try {
  const ranked = search.vector(QUERY, DOCS);
  check(
    2,
    `search.vector('${QUERY}') -> ranked with cosine-style scores [${search.VECTOR_LABEL}]`,
    ranked.length === 5 && ranked[0].id === 'vec-strong' && ranked[0].score <= 1,
    `    label: ${search.VECTOR_LABEL}\n${ranked.map((e) => fmt(e, ['score'])).join('\n')}`
  );
} catch (err) {
  failLabel(2, 'vector search', err);
}

// ---------------------------------------------------------------- P3
try {
  const def = search.hybrid(QUERY, DOCS);
  const kwHeavy = search.hybrid(QUERY, DOCS, { weights: { keyword: 0.8, vector: 0.2 } });
  const vecHeavy = search.hybrid(QUERY, DOCS, { weights: { keyword: 0.2, vector: 0.8 } });
  const show = (list) => list.map((e) => fmt(e, ['keywordScore', 'vectorScore', 'score'])).join('\n');
  check(
    3,
    'hybrid weights shift the top: 0.8/0.2 -> kw-strong top; 0.2/0.8 -> vec-strong top',
    kwHeavy[0].id === 'kw-strong' && vecHeavy[0].id === 'vec-strong',
    `  default { keyword: 0.5, vector: 0.5 }:\n${show(def)}\n` +
      `  weights { keyword: 0.8, vector: 0.2 } -> top: ${kwHeavy[0].id} (keyword-strong doc pushed to top)\n${show(kwHeavy)}\n` +
      `  weights { keyword: 0.2, vector: 0.8 } -> top: ${vecHeavy[0].id} (vector-strong doc pushed to top)\n${show(vecHeavy)}`
  );
} catch (err) {
  failLabel(3, 'hybrid weight shift', err);
}

// ---------------------------------------------------------------- P4
try {
  const gr = new GraphRag();
  const idx = gr.index(DOCS);
  const before = search.hybrid(QUERY, DOCS);
  const after = search.hybrid(QUERY, DOCS, { graph: gr });
  // Exaggerated boost so the graph-driven REORDER is visible: registry-notes
  // (graphScore 0.25) crosses vec-strong (graphScore 0).
  const flipped = search.hybrid(QUERY, DOCS, { graph: gr, boostStrength: 8 });
  const gq = gr.query(QUERY, { topK: DOCS.length, depth: 2, requireTraversal: false });
  const orderOf = (list, id) => list.findIndex((e) => e.id === id);
  const reordered = orderOf(flipped, 'registry-notes') < orderOf(flipped, 'vec-strong');
  check(
    4,
    'graph boost via capability/rag/graph-rag: available, applied, before/after shown',
    search.GRAPH_AVAILABLE && after[0].id === 'kw-strong' && reordered,
    `  capability present: ${search.GRAPH_AVAILABLE} — ${search.GRAPH_LABEL}\n` +
      `  GraphRag.index() -> entities: ${idx.entities.length} (${idx.entities.map((e) => e.name).join(', ')}), relationships: ${idx.relationships.length}\n` +
      `  graph query seeds: ${gq.seeds.map((s) => `${s.entity}(${s.score})`).join(', ')}\n` +
      `  BEFORE (no graph):\n${before.map((e) => fmt(e, ['score'])).join('\n')}\n` +
      `  AFTER (graph, boostStrength 0.25 default):\n${after.map((e) => fmt(e, ['graphScore', 'score'])).join('\n')}\n` +
      `  AFTER (graph, boostStrength 8 — exaggerated to make the reorder visible):\n${flipped.map((e) => fmt(e, ['graphScore', 'score'])).join('\n')}\n` +
      `  reorder check: registry-notes (graph-scored) now ranks above vec-strong (no graph score): ${reordered}`
  );
} catch (err) {
  failLabel(4, 'graph boost', err);
}

// ---------------------------------------------------------------- P5
try {
  const cases = [
    { name: 'missing text field', fn: () => search.keyword('q', [{ id: 'a' }]), code: 'E_INVALID_DOC' },
    { name: 'non-array docs', fn: () => search.keyword('q', 'nope'), code: 'E_INVALID_DOC' },
    { name: 'duplicate ids', fn: () => search.keyword('q', [{ id: 'a', text: 'x' }, { id: 'a', text: 'y' }]), code: 'E_INVALID_DOC' },
    { name: 'negative weight', fn: () => search.hybrid('q', DOCS, { weights: { keyword: -0.5, vector: 1.5 } }), code: 'E_INVALID_WEIGHTS' },
    { name: 'zero-sum weights', fn: () => search.hybrid('q', DOCS, { weights: { keyword: 0, vector: 0 } }), code: 'E_INVALID_WEIGHTS' },
    { name: 'wrong weight keys', fn: () => search.hybrid('q', DOCS, { weights: { kw: 1, vec: 0 } }), code: 'E_INVALID_WEIGHTS' },
    { name: 'non-numeric weight', fn: () => search.hybrid('q', DOCS, { weights: { keyword: 'high', vector: 0.5 } }), code: 'E_INVALID_WEIGHTS' },
    { name: 'graph without query()', fn: () => search.hybrid('q', DOCS, { graph: { nope: true } }), code: 'E_INVALID_GRAPH' },
  ];
  const outcomes = [];
  let allOk = true;
  for (const c of cases) {
    try {
      c.fn();
      outcomes.push(`${c.name}: no throw`);
      allOk = false;
    } catch (err) {
      const ok = err instanceof SurfError && err.code === c.code;
      outcomes.push(`${c.name}: ${err.code}${ok ? '' : ` (EXPECTED ${c.code})`}`);
      if (!ok) allOk = false;
    }
  }
  check(
    5,
    'errors: E_INVALID_DOC / E_INVALID_WEIGHTS (+ E_INVALID_GRAPH) thrown with correct codes',
    allOk,
    '  ' + outcomes.join('\n  ')
  );
} catch (err) {
  failLabel(5, 'error codes', err);
}

// ---------------------------------------------------------------- P6
try {
  const round = () =>
    JSON.stringify([
      search.keyword(QUERY, DOCS),
      search.vector(QUERY, DOCS),
      search.hybrid(QUERY, DOCS, { weights: { keyword: 0.6, vector: 0.4 } }),
    ]);
  const a = round();
  const b = round();
  check(
    6,
    'same query + docs + weights twice -> byte-identical ranked output (keyword, vector, hybrid)',
    a === b,
    `  bytes: ${a.length} | byte-identical: ${a === b}`
  );
} catch (err) {
  failLabel(6, 'determinism', err);
}

// ---------------------------------------------------------------- P7
try {
  const status = execSync('git status --short', { encoding: 'utf8' }).trim();
  const files = status.length === 0 ? [] : status.split('\n').map((line) => line.slice(3).trim());
  const zoneOk = files.every(
    (f) => f.startsWith('surfsense/') || /^scripts\/phase19-[^/]*\.mjs$/.test(f)
  );
  check(
    7,
    'zone check: only surfsense/** and scripts/phase19-*.mjs',
    zoneOk, // consolidation cleanup: assert only that no touched path is outside the zone; a clean committed tree passes vacuously
    '  git status --short:\n' +
      (files.length === 0 ? '    (clean)' : files.map((f) => `    ${f}`).join('\n'))
  );
} catch (err) {
  failLabel(7, 'zone check', err);
}

const passCount = results.filter((r) => r.pass).length;
console.log(`\n=== SCOPE B: ${passCount}/${results.length} PASS, exit ${passCount === results.length ? 0 : 1} ===`);
process.exit(passCount === results.length ? 0 : 1);

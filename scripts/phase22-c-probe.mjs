#!/usr/bin/env node
/**
 * JEXI OS — Phase 22 Scope C — LIVE PROBES P1–P7 (graph-based RAG).
 *
 * Re-runnable, raw output only. Nothing simulated: P5 SIGKILLs a real child
 * process between index and re-read; P4 compares two independent indexes of
 * the same input by canonical hash including entity and edge order.
 *
 * Usage: node scripts/phase22-c-probe.mjs [--only=P1,…]
 *        node scripts/phase22-c-probe.mjs --child-index   (internal)
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  GraphRag, RagError, LLM_EXTRACTION_LABEL, snapshotDir,
} from '../capabilities/graph/rag/index.js';

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(SCRIPTS, '..');
const only = (process.argv.find((a) => a.startsWith('--only=')) || '').replace('--only=', '');
const run = (id) => !only || only.split(',').includes(id);

const CHILD_MODE = process.argv.includes('--child-index');

const DOCS = [
  { id: 'lightrag-notes', text: 'LightRAG is a retrieval augmented generation system from HKUDS. LightRAG indexes documents into a knowledge graph. The knowledge graph stores entities and relationships. LightRAG complements vector search and BM25 with graph traversal.' },
  { id: 'graph-notes', text: 'A knowledge graph uses an adjacency list to represent edges. Graph traversal walks the adjacency list from an entity to its neighbours. Entity extraction builds the nodes of the graph.' },
  { id: 'jexi-notes', text: 'JEXI uses a retrieval layer for memory. The retrieval layer indexes documents and ranks results. Graph RAG complements the existing vector search in the retrieval layer.' },
];

function freshGraph() {
  return new GraphRag();
}

/* ---- internal child mode: index, snapshot, then hold for SIGKILL ---- */
if (CHILD_MODE) {
  const g = freshGraph();
  const r = g.index(DOCS);
  const marker = path.join(snapshotDir(), 'child-indexed');
  fs.writeFileSync(marker, String(process.pid));
  console.log(JSON.stringify({ child: 'indexed', pid: process.pid, nodes: r.entities.length, edges: r.relationships.length }));
  setInterval(() => {}, 1000);
}

const results = {};
const pass = (id, n) => { results[id] = `PASS${n ? ` — ${n}` : ''}`; };
const fail = (id, n) => { results[id] = `FAIL — ${n}`; };
function header(id, title) {
  console.log('\n═══════════════════════════════════════════════════');
  console.log(`${id} — ${title}`);
  console.log('═══════════════════════════════════════════════════');
}
const show = (l, v) => console.log(`${l}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);

/** Canonical hash of a graph: entity order AND edge order included. */
function graphHash(g) {
  const canonical = JSON.stringify({
    nodes: g.entityList().map((n) => [n.key, n.name, n.type, n.degree]),
    edges: g.relationshipList().map((e) => [e.id, e.source, e.target, e.type, e.weight]),
  });
  return createHash('sha256').update(canonical).digest('hex');
}

function P1() {
  header('P1', 'index 3 short documents');
  const g = freshGraph();
  const r = g.index(DOCS);
  show('returned shape', { docCount: r.docCount, entityCount: r.entities.length, relationshipCount: r.relationships.length, extraction_mode: r.extraction_mode, label: r.label });
  show('entities', r.entities.map((e) => `${e.name} [${e.type}] deg=${e.degree}`));
  show('relationships (first 12)', r.relationships.slice(0, 12).map((e) => `${e.source} -${e.type}-> ${e.target} (w=${e.weight})`));
  show('snapshot', g.snapshotPath());
  const ok = r.docCount === 3 && r.entities.length > 0 && r.relationships.length > 0;
  (ok ? pass : fail)('P1', ok
    ? `${r.docCount} docs -> ${r.entities.length} entities, ${r.relationships.length} relationships`
    : 'index produced an empty graph');
}

function P2() {
  header('P2', 'show the graph — entities + adjacency');
  const g = freshGraph();
  g.index(DOCS);
  for (const [key, list] of g.adjacencyList()) {
    const node = g.nodes.get(key);
    console.log(`  ${node.name} [${node.type}]  degree=${node.degree}`);
    for (const step of list) {
      const other = g.nodes.get(step.to);
      console.log(`      ${step.direction === 'out' ? '-->' : '<--'} ${other ? other.name : step.to}  (${step.relation})`);
    }
  }
  const adj = g.adjacencyList();
  const totalDegree = adj.reduce((n, [, l]) => n + l.length, 0);
  show('adjacency entries', adj.length);
  show('sum of degrees (== 2 x edges)', [totalDegree, g.edges.size, totalDegree === g.edges.size * 2]);
  const ok = adj.length > 0 && totalDegree === g.edges.size * 2;
  (ok ? pass : fail)('P2', ok
    ? `adjacency list is a real graph: ${adj.length} nodes, sum(deg)=${totalDegree} = 2 x ${g.edges.size} edges`
    : `adjacency inconsistent: sum(deg)=${totalDegree}, edges=${g.edges.size}`);
}

function P3() {
  header('P3', 'query requiring traversal — results + graphPath');
  const g = freshGraph();
  g.index(DOCS);
  const question = 'How does LightRAG complement vector search using a knowledge graph?';
  const r = g.query(question, { topK: 3, depth: 2 });
  show('question', question);
  show('seeds', r.seeds);
  show('matched_entities', r.matched_entities);
  show('results', r.results.map((x) => ({ docId: x.docId, score: x.score, matchedEntity: x.matchedEntity, entityType: x.entityType, via: x.via })));
  show('graphPath', r.graphPath);

  // A second corpus where one document shares NO entity with the seed, so it
  // can only be reached by chaining through an intermediate entity. This is
  // the case that proves the result came from traversal, not keyword matching.
  const chain = freshGraph();
  chain.index([
    { id: 'seed-doc', text: 'LightRAG indexes documents into a knowledge graph.' },
    { id: 'hop-1-doc', text: 'The knowledge graph uses an adjacency list for traversal.' },
    { id: 'hop-2-doc', text: 'The adjacency list stores neighbours of every entity node.' },
  ]);
  const q2 = 'How does LightRAG index documents?';
  const r2 = chain.query(q2, { topK: 5, depth: 3 });
  const deep = r2.results.find((x) => x.via.length > 2);
  show('traversal question', q2);
  show('traversal results', r2.results.map((x) => ({ docId: x.docId, score: x.score, via: x.via })));
  show('traversal graphPath', r2.graphPath);
  show('multi-hop result', deep && { docId: deep.docId, chainLength: deep.via.length, via: deep.via });

  const multiHop = Boolean(deep);
  const ok = r.results.length > 0 && r.graphPath.length > 0 && multiHop
    && r.graphPath.every((p) => Array.isArray(p.path));
  (ok ? pass : fail)('P3', ok
    ? `dense corpus: ${r.results.length} result(s), all with a graphPath; chained corpus: '${deep.docId}' reached only via a ${deep.via.length}-entity chain`
    : 'no multi-hop traversal path returned');
}

function P4() {
  header('P4', 'determinism — same 3 docs twice -> identical graph');
  const a = freshGraph(); const ra = a.index(DOCS);
  const b = freshGraph(); const rb = b.index(DOCS.map((d) => ({ ...d })));
  const ha = graphHash(a); const hb = graphHash(b);
  show('entity order A', a.entityList().map((n) => n.key));
  show('entity order B', b.entityList().map((n) => n.key));
  show('edge order A', a.relationshipList().map((e) => `${e.source}~${e.target}~${e.type}`));
  show('edge order B', b.relationshipList().map((e) => `${e.source}~${e.target}~${e.type}`));
  show('graph hash A', ha);
  show('graph hash B', hb);
  const orderEqual = JSON.stringify(a.entityList().map((n) => n.key)) === JSON.stringify(b.entityList().map((n) => n.key))
    && JSON.stringify(a.relationshipList().map((e) => e.id)) === JSON.stringify(b.relationshipList().map((e) => e.id));
  const countsEqual = ra.entities.length === rb.entities.length && ra.relationships.length === rb.relationships.length;
  const ok = ha === hb && orderEqual && countsEqual;
  (ok ? pass : fail)('P4', ok
    ? `identical graph — entities ${ra.entities.length}/${rb.entities.length}, edges ${ra.relationships.length}/${rb.relationships.length}, sha256=${ha}`
    : 'graphs differ between runs');
}

function P5() {
  header('P5', 'SIGKILL persistence — graph reloads from disk');
  const marker = path.join(snapshotDir(), 'child-indexed');
  try { fs.rmSync(marker); } catch { /* absent */ }
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--child-index'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    const wait = setInterval(() => {
      if (!fs.existsSync(marker)) return;
      clearInterval(wait);
      const pid = child.pid;
      process.kill(pid, 'SIGKILL');
      child.on('exit', (code, signal) => {
        show('child stdout', out.trim());
        show('child exit', { code, signal });
        const g2 = freshGraph();
        const loaded = g2.load();
        show('fresh-process graph.load()', loaded);
        show('reloaded nodes / edges', [g2.nodes.size, g2.edges.size]);
        let q = null;
        if (loaded) q = g2.query('knowledge graph adjacency', { topK: 2 });
        show('query after reload', q && { results: q.results.length, graphPath: q.graphPath.length, firstDoc: q.results[0]?.docId });
        const ok = loaded && g2.nodes.size > 0 && q && q.results.length > 0 && signal === 'SIGKILL';
        (ok ? pass : fail)('P5', ok
          ? `graph survived SIGKILL (signal ${signal}) and reloaded: ${g2.nodes.size} nodes, ${g2.edges.size} edges, query returned ${q.results.length}`
          : 'graph did not reload after SIGKILL');
        resolve();
      });
    }, 50);
    setTimeout(() => { clearInterval(wait); try { child.kill('SIGKILL'); } catch { /* gone */ }
      fail('P5', 'child never signalled completion (timeout)'); resolve(); }, 20000);
  });
}

function P6() {
  header('P6', 'empty / malformed document set -> E_INVALID_DOCUMENTS');
  const cases = [
    ['index([])', []],
    ['index([""])', ['']],
    ['index(["   "])', ['   ']],
    ['index("not an array")', 'not an array'],
    ['index([null])', [null]],
    ['index([{}])', [{}]],
    ['index([{id:"a"}])', [{ id: 'a' }]],
    ['index([{id:"a",text:42}])', [{ id: 'a', text: 42 }]],
    ['index([{id:"dup",text:"x"}, {id:"dup",text:"y"}])', [{ id: 'dup', text: 'a graph' }, { id: 'dup', text: 'another graph' }]],
  ];
  let correct = 0;
  for (const [label, input] of cases) {
    const g = freshGraph();
    try {
      g.index(input);
      console.log(`  ${label.padEnd(42)} -> NO ERROR (FAIL)`);
    } catch (err) {
      const isRag = err instanceof RagError && err.code === 'E_INVALID_DOCUMENTS';
      console.log(`  ${label.padEnd(42)} -> ${err.code}: ${err.reason}`);
      if (isRag) correct += 1;
    }
  }
  const ok = correct === cases.length;
  (ok ? pass : fail)('P6', ok
    ? `${correct}/${cases.length} malformed inputs rejected with E_INVALID_DOCUMENTS and a specific reason`
    : `${correct}/${cases.length} rejected correctly`);
}

function P7() {
  header('P7', 'zone check — git status --short');
  const st = spawnSync('git', ['status', '--short'], { cwd: REPO, encoding: 'utf8' });
  const lines = (st.stdout || '').split('\n').filter(Boolean);
  show('status -s (pre-commit working tree)', lines.length ? lines : '(clean)');
  const outOfZone = lines
    .map((l) => l.replace(/^\s*\S+\s+/, ''))
    .filter((f) => !(f.startsWith('capability/rag/') || /^scripts\/phase22-.*\.mjs$/.test(f)));
  show('out-of-zone entries', outOfZone);
  const ok = outOfZone.length === 0;
  (ok ? pass : fail)('P7', ok
    ? 'every changed path is under capability/rag/** or scripts/phase22-*.mjs'
    : `out-of-zone: ${outOfZone.join(', ')}`);
}

async function main() {
  console.log(`PROBE phase22-c  repo=${REPO}  node=${process.version}`);
  console.log(`label: ${LLM_EXTRACTION_LABEL}  snapshotDir: ${snapshotDir()}`);
  if (run('P1')) P1();
  if (run('P2')) P2();
  if (run('P3')) P3();
  if (run('P4')) P4();
  if (run('P5')) await P5();
  if (run('P6')) P6();
  if (run('P7')) P7();
  console.log('\n──────────── VERDICTS ────────────');
  for (const [k, v] of Object.entries(results)) console.log(`${k}: ${v}`);
  const failed = Object.values(results).some((v) => v.startsWith('FAIL'));
  process.exit(failed ? 1 : 0);
}

if (!CHILD_MODE) await main();
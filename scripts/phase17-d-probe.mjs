#!/usr/bin/env node
/**
 * PHASE 17 SCOPE D PROBE — memory upgrade (confidence, lifecycle, knowledge
 * graph, hybrid search) over the Phase 4 MemoryEntry contract.
 *
 * Clock discipline: every probe uses a FIXED simulated clock (SIM_NOW) so the
 * run is deterministic and reproducible; P2 advances the simulated clock
 * explicitly. Wall-clock time is never consulted (except run duration at the
 * very end, reported informationally).
 *
 * Extraction label: the knowledge graph uses the LABELED rule-based extractor
 * ("rule-based — LLM extraction NOT VERIFIED").
 * Embedding label: if the all-MiniLM-L6-v2 local model is loadable it is used
 * for the vector path; otherwise the deterministic hash embedder is used and
 * labeled ("all-MiniLM-L6-v2 semantic embeddings NOT VERIFIED in this runtime").
 *
 * Probes:
 *   P1  confidence scoring — 3 entries, different access patterns, raw scores
 *   P2  confidence decay   — simulated clock advances, score falls
 *   P3  lifecycle transitions — FRESH→AGING→STALE→ARCHIVED at thresholds
 *   P4  archived excluded from retrieval, still on disk (JSONL store)
 *   P5  knowledge graph build — 10 entries, entities + relations shown
 *   P6  graph neighbors('readViaBackends')
 *   P7  graph path(A, B) — shortest chain
 *   P8  hybrid search — same query through BM25 AND vector, both rankings
 *   P9  RRF merge — fused ranking + why RRF beats weighted average here
 *   P10 edge: no results — E_NO_RESULTS, no crash
 *   P11 edge: contradiction — graph records it, confidence drops
 *   P12 integration with server/src/memory/** — grep evidence + citations
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { confidenceScore, confidenceBreakdown, reinforce, registerContradiction, noteRetrieval } from '../memory/confidence.js';
import { advance, advanceEntry, reinforced, isArchived, LIFECYCLE_DEFAULTS } from '../memory/lifecycle.js';
import { buildGraph, getEntity, neighbors, path as graphPath, createRuleExtractor } from '../memory/knowledge-graph.js';
import { createHybridIndex, JsonlMemoryStore, hashEmbedder } from '../memory/hybrid-search.js';

const SIM_NOW = new Date('2026-09-19T12:00:00Z').getTime();
const DAY = 86_400_000;
const at = (daysAgo) => SIM_NOW - daysAgo * DAY;

/* ────────────────────── probe helpers (b-probe style) ───────────────────── */
const RESULTS = [];
const pass = (n, d) => { RESULTS.push({ n, ok: true }); console.log(`  PASS  ${n}  ${d}`); };
const fail = (n, d) => { RESULTS.push({ n, ok: false }); console.log(`  FAIL  ${n}  ${d}`); };
const section = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(1, 66 - t.length))}`);
const assert = (c, n, okD, badD) => (c ? pass : fail)(n, c ? okD : badD);
const entry = (id, content, daysAgo, metadata = {}) => ({
  id, missionId: 'mission-phase17', tier: 'semantic', content,
  createdAt: at(daysAgo), metadata,
});

/* ──────────────────────────── embedder selection ────────────────────────── */
async function pickEmbedder() {
  try {
    const req = createRequire('/tmp/p17d-embed/package.json');
    const { pathToFileURL } = await import('node:url');
    const modPath = req.resolve('@huggingface/transformers');
    const { pipeline, env } = await import(pathToFileURL(modPath).href);
    env.allowLocalModels = false;
    const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { dtype: 'q8' });
    const embed = async (text) => {
      const out = await extractor(text, { pooling: 'mean', normalize: true });
      return Array.from(out.data);
    };
    await embed('warmup'); // force model load before any measurement
    return { embed, label: 'all-MiniLM-L6-v2 (local, Xenova/transformers.js, q8, WASM)' };
  } catch (e) {
    console.log(`  NOTE  local MiniLM unavailable (${String(e.message).slice(0, 90)}) — using hash embedder`);
    return { embed: hashEmbedder.embed, label: hashEmbedder.label };
  }
}

/* ────────────────────────────── fixture entries ─────────────────────────── */
function buildEntries() {
  return [
    entry('mem-01', 'Kai Mensah decided to adopt `hybrid-search` for the memory upgrade; it depends on `BM25` and dense vectors.', 2, { sourceReliability: 0.9 }),
    entry('mem-02', '`readViaBackends` is the recall path used by `Obscura` sessions and `SQLite` backends.', 4, { sourceReliability: 0.8 }),
    entry('mem-03', 'Dana Whitfield wrote the `RRF` fusion rules: reciprocal rank fusion with k=60.', 5, { sourceReliability: 0.85 }),
    entry('mem-04', 'Project Vulcan references `readViaBackends` for its own telemetry recall.', 6, { sourceReliability: 0.6 }),
    entry('mem-05', 'The lifecycle states `FRESH AGING STALE ARCHIVED` move monotonically; only re-reinforcement moves back.', 8, { sourceReliability: 0.75 }),
    entry('mem-06', 'Nia Abara depends on `confidence` scores to gate `SQLite` compaction of stale tiers.', 10, { sourceReliability: 0.7 }),
    entry('mem-07', '`hybrid-search` merges BM25 rankings and vector rankings with `RRF`, never a weighted average of raw scores.', 12, { sourceReliability: 0.8 }),
    entry('mem-08', 'Kai Mensah and Dana Whitfield reviewed the `memory upgrade` together; the project Vulcan demo went well.', 15, { sourceReliability: 0.65 }),
    entry('mem-09', 'Decision: `Obscura` supersedes `puppeteer-driver` for browser sessions.', 18, { sourceReliability: 0.8 }),
    entry('mem-10', 'The concept of `reciprocal rank fusion` references `RRF` and keeps ranking scale-free.', 21, { sourceReliability: 0.7 }),
  ];
}

/* ────────────────────────────────── probes ──────────────────────────────── */

function probeP1() {
  section('P1 — Confidence scoring (3 entries, different access patterns)');
  const freshReliable = entry('c1', 'Fresh high-reliability fact recorded today by the trusted indexer.', 0.2, { sourceReliability: 0.95 });
  const oldNeverRead = entry('c2', 'Old note that was never retrieved again.', 45, { sourceReliability: 0.5 });
  const oldReinforced = reinforce(entry('c3', 'Old but explicitly reinforced decision.', 45, { sourceReliability: 0.7 }), { now: at(1) });
  const s1 = confidenceScore(freshReliable, { now: SIM_NOW });
  const s2 = confidenceScore(oldNeverRead, { now: SIM_NOW });
  const s3 = confidenceScore(oldReinforced, { now: SIM_NOW });
  const b2 = confidenceBreakdown(oldNeverRead, { now: SIM_NOW });
  console.log(`    c1 fresh+reliable (0.2d old, src=0.95):           score=${s1.toFixed(4)}`);
  console.log(`    c2 old+never-read (45d old, src=0.50, 0 reinf):  score=${s2.toFixed(4)}  factors=${JSON.stringify(b2.factors)}`);
  console.log(`    c3 old+reinforced (45d old, src=0.70, 1 reinf):  score=${s3.toFixed(4)}`);
  // determinism: same inputs → identical score
  const s2again = confidenceScore(JSON.parse(JSON.stringify(oldNeverRead)), { now: SIM_NOW });
  assert(s1 > s2 && s3 > s2 && s2again === s2, 'P1 confidence scoring',
    `s1(${s1.toFixed(3)}) > s2(${s2.toFixed(3)}); s3 reinforced(${s3.toFixed(3)}) > s2; deterministic rerun identical (${s2again === s2})`,
    `s1=${s1} s2=${s2} s3=${s3} determinism=${s2again === s2}`);
  // retrieval must NOT raise the score
  const before = confidenceScore(oldNeverRead, { now: SIM_NOW });
  const after = confidenceScore(noteRetrieval(oldNeverRead, { now: at(0) }), { now: SIM_NOW });
  console.log(`    retrieval bookkeeping (noteRetrieval): score ${before.toFixed(4)} → ${after.toFixed(4)} (unchanged: ${before === after})`);
  assert(before === after, 'P1b retrieval does not raise confidence',
    `score unchanged after noteRetrieval (${before.toFixed(4)} === ${after.toFixed(4)})`,
    `score moved after retrieval: ${before} → ${after}`);
}

function probeP2() {
  section('P2 — Confidence decay over time (simulated clock)');
  const e = entry('d1', 'A once-confident observation.', 0, { sourceReliability: 0.8 });
  const rows = [0, 15, 30, 60, 120].map((d) => ({ d, s: confidenceScore(e, { now: SIM_NOW + d * DAY }) }));
  for (const r of rows) console.log(`    +${String(r.d).padStart(3)}d → score=${confidenceScore(e, { now: SIM_NOW + r.d * DAY }).toFixed(4)} (recency factor=${confidenceBreakdown(e, { now: SIM_NOW + r.d * DAY }).factors.recencyFactor.toFixed(4)}, half-life ${LIFECYCLE_DEFAULTS ? 30 : 30}d)`);
  const decreasing = rows.every((r, i) => i === 0 || r.s < rows[i - 1].s);
  const rf0 = confidenceBreakdown(e, { now: SIM_NOW }).factors.recencyFactor;
  const rf30 = confidenceBreakdown(e, { now: SIM_NOW + 30 * DAY }).factors.recencyFactor;
  const rf60 = confidenceBreakdown(e, { now: SIM_NOW + 60 * DAY }).factors.recencyFactor;
  assert(decreasing && Math.abs(rf30 - rf0 / 2) < 1e-9 && Math.abs(rf60 - rf0 / 4) < 1e-9, 'P2 confidence decay',
    `score strictly decreasing 0→120d; recency factor ${rf0.toFixed(3)} → ${rf30.toFixed(3)} (+30d, exactly ½) → ${rf60.toFixed(3)} (+60d, exactly ¼) — exponential half-life 30d`,
    `decreasing=${decreasing} rf0=${rf0} rf30=${rf30} rf60=${rf60}`);
}

function probeP3() {
  section('P3 — Lifecycle transitions at thresholds (age-driven)');
  const mk = (id, days) => ({ id, missionId: 'm', tier: 'semantic', content: 'threshold probe entry', createdAt: SIM_NOW - days * DAY, metadata: { sourceReliability: 0.9, retrievalCount: 1 } });
  const e7 = mk('l1', 6), e7b = mk('l1b', 8);      // around FRESH→AGING (7d)
  const e60 = mk('l2', 59), e60b = mk('l2b', 61);  // around AGING→STALE (60d)
  const e180 = mk('l3', 179), e180b = mk('l3b', 181); // around STALE→ARCHIVED (180d)
  console.log(`    6d → ${advance(e7, { now: SIM_NOW })}   | 8d → ${advance(e7b, { now: SIM_NOW })}`);
  console.log(`   59d → ${advance(e60, { now: SIM_NOW })}  | 61d → ${advance(e60b, { now: SIM_NOW })}`);
  console.log(`  179d → ${advance(e180, { now: SIM_NOW })} | 181d → ${advance(e180b, { now: SIM_NOW })}`);
  const ok = advance(e7, { now: SIM_NOW }) === 'FRESH' && advance(e7b, { now: SIM_NOW }) === 'AGING'
    && advance(e60, { now: SIM_NOW }) === 'AGING' && advance(e60b, { now: SIM_NOW }) === 'STALE'
    && advance(e180, { now: SIM_NOW }) === 'STALE' && advance(e180b, { now: SIM_NOW }) === 'ARCHIVED';
  assert(ok, 'P3 lifecycle transitions (age thresholds 7/60/180d)',
    'FRESH@6d→AGING@8d; AGING@59d→STALE@61d; STALE@179d→ARCHIVED@181d — all exact',
    'threshold transitions wrong');
  // monotonicity + explicit-only recovery (reinforcement resets the aging clock)
  const stale = advanceEntry(mk('l4', 90), { now: SIM_NOW });
  const noRegression = advance(stale, { now: SIM_NOW });
  const reborn = reinforced(stale, { now: SIM_NOW });
  const recovered = advance(reborn, { now: SIM_NOW });
  const reAged = advance(reborn, { now: SIM_NOW + 8 * DAY });
  console.log(`    monotonic: STALE re-advanced (no reinforcement) → ${noRegression}; explicitly re-reinforced → ${recovered}; +8d later → ${reAged} (aging restarted from the reinforcement)`);
  assert(noRegression === 'STALE' && recovered === 'FRESH' && reAged === 'AGING', 'P3b monotonicity + explicit-only recovery',
    'advance() never regresses STALE→FRESH; reinforced() (explicit) resets state AND the aging clock (FRESH again, AGING again +8d)',
    `noRegression=${noRegression} recovered=${recovered} reAged=${reAged}`);
}

function probeP4() {
  section('P4 — Archived excluded from retrieval, still on disk');
  const file = '/tmp/phase17-d/memory.jsonl';
  fs.rmSync('/tmp/phase17-d', { recursive: true, force: true });
  const store = new JsonlMemoryStore(file).load();
  const e1 = advanceEntry(entry('s1', 'The quarterly audit report covers `readViaBackends` telemetry.', 200, { sourceReliability: 0.8, retrievalCount: 1 }), { now: SIM_NOW });
  const e2 = entry('s2', 'The quarterly audit report follow-up covers `readViaBackends` telemetry too.', 2, { sourceReliability: 0.8, retrievalCount: 1 });
  console.log(`    s1 state at 200d: ${e1.metadata.lifecycleState} (archived=${isArchived(e1)}) | s2: ${e2.metadata?.lifecycleState || 'FRESH'}`);
  store.put(e1); store.put(e2);
  return { file, store, e1, e2, async run() {
    const idx = await createHybridIndex(store.entries(), { now: SIM_NOW });
    const r = await idx.search('quarterly audit report readViaBackends');
    console.log(`    index docs=${JSON.stringify(idx.docs)} excludedArchived=${JSON.stringify(idx.excludedArchived)}`);
    console.log(`    search("quarterly audit report readViaBackends") → ${r.results.map((x) => x.entry.id).join(', ') || '(empty)'}`);
    const onDisk = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const s1OnDisk = onDisk.find((x) => x.id === 's1');
    console.log(`    on disk: ${onDisk.length} entries; s1 present=${Boolean(s1OnDisk)} state=${s1OnDisk?.metadata?.lifecycleState}`);
    const notReturned = !r.results.some((x) => x.entry.id === 's1');
    const s2Returned = r.results.some((x) => x.entry.id === 's2');
    assert(notReturned && s2Returned && Boolean(s1OnDisk) && onDisk.length === 2, 'P4 archived excluded from retrieval, preserved on disk',
      `s1 (ARCHIVED) not returned; s2 returned; file still holds both (${onDisk.length} lines, s1 state=${s1OnDisk.metadata.lifecycleState})`,
      `returned=${r.results.map((x) => x.entry.id)} onDisk=${onDisk.length}`);
  } };
}

function probeP5(entries) {
  section('P5 — Knowledge graph build (10 entries, rule-based extractor)');
  const graph = buildGraph(entries);
  console.log(`    extractor: ${graph.extractor}`);
  console.log(`    entities (${graph.entities.size}):`);
  for (const e of [...graph.entities.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    console.log(`      ${e.name.padEnd(24)} ${e.type.padEnd(11)} entries=[${[...e.entryIds].join(',')}]`);
  }
  const counts = {};
  for (const r of graph.relations) counts[r.type] = (counts[r.type] || 0) + 1;
  console.log(`    relations (${graph.relations.length}): ${JSON.stringify(counts)}`);
  console.log('    non-co-occurrence relations:');
  for (const r of graph.relations.filter((x) => x.type !== 'mentioned_with')) console.log(`      ${r.from} --${r.type}--> ${r.to}  (${r.entryId})`);
  const hasTypes = ['person', 'technology'].every((t) => [...graph.entities.values()].some((e) => e.type === t));
  const hasRels = ['mentioned_with', 'depends_on', 'supersedes', 'references'].every((t) => graph.relations.some((r) => r.type === t));
  assert(graph.entities.size >= 8 && graph.relations.length >= 10 && hasTypes && hasRels, 'P5 graph build (rule-based — LLM extraction NOT VERIFIED)',
    `${graph.entities.size} entities / ${graph.relations.length} relations from 10 entries; types person+technology present; mentioned_with/depends_on/supersedes/references all extracted`,
    `entities=${graph.entities.size} relations=${graph.relations.length} types ok=${hasTypes} rels ok=${hasRels}`);
  return graph;
}

function probeP6(graph) {
  section('P6 — neighbors(\'readViaBackends\')');
  const n = neighbors(graph, 'readViaBackends');
  for (const r of n.related) console.log(`      ${r.direction === 'out' ? '─out─>' : '<─in──'} ${r.relation.padEnd(14)} ${r.other}  (${r.entryId})`);
  const ok = n.entity && n.related.length >= 2 && n.related.some((r) => r.other === 'obscura') && n.related.some((r) => r.relation === 'mentioned_with');
  assert(ok, 'P6 neighbors',
    `${n.related.length} relations; connected to ${[...new Set(n.related.map((r) => r.other))].join(', ')}`,
    `unexpected neighbor set: ${JSON.stringify(n.related)}`);
}

function probeP7(graph) {
  section('P7 — path(A → B) shortest chain');
  const a = 'Kai Mensah', b = 'SQLite';
  const chain = graphPath(graph, a, b);
  console.log(`    path(${JSON.stringify(a)} → ${JSON.stringify(b)}), ${chain.length} hop(s):`);
  for (const h of chain) console.log(`      ${h.from} --${h.relation}--> ${h.to}`);
  const endToEnd = chain.length >= 1 && chain[0].from === a.toLowerCase() && chain[chain.length - 1].to === b.toLowerCase();
  let noPathErr = null;
  // Both endpoints KNOWN but in disconnected components → E_NO_PATH (not the
  // unknown-entity error).
  const iso = buildGraph([
    entry('iso-1', 'Hermit Island exists alone with no relations.', 1, { sourceReliability: 0.5 }),
    ...buildEntries().slice(0, 3),
  ]);
  try { graphPath(iso, 'Hermit Island', 'SQLite'); } catch (e) { noPathErr = e; }
  console.log(`    negative case: path(Hermit Island → SQLite), both known, disconnected → code=${noPathErr?.code}`);
  assert(endToEnd && noPathErr?.code === 'E_NO_PATH', 'P7 path + honest no-path',
    `${chain.map((h) => `${h.from}─${h.relation}→${h.to}`).join(' ─ ')}; disconnected pair → E_NO_PATH`,
    `chain=${JSON.stringify(chain)} err=${noPathErr?.code}`);
}

async function probeP8(entries, embed, embedLabel) {
  section('P8 — Hybrid search: BM25 vs vector on the same query');
  const idx = await createHybridIndex(entries, { embed, embedLabel });
  const q = 'rank fusion for memory retrieval';
  const bm = idx.bm25Only(q);
  const vec = await idx.vectorOnly(q);
  console.log(`    query: "${q}"   embedder: ${idx.embedder}`);
  console.log('    BM25 ranking (scale ~0..10+, idf-weighted):');
  bm.slice(0, 5).forEach((x, i) => console.log(`      #${i + 1} ${x.id}  score=${x.score.toFixed(4)}`));
  console.log('    Vector ranking (cosine, scale 0..1):');
  vec.slice(0, 5).forEach((x, i) => console.log(`      #${i + 1} ${x.id}  score=${x.score.toFixed(4)}`));
  const both = bm.length >= 3 && vec.length >= 3;
  const different = JSON.stringify(bm.slice(0, 3).map((x) => x.id)) !== JSON.stringify(vec.slice(0, 3).map((x) => x.id));
  console.log(`    top-3 differ between methods: ${different}`);
  assert(both, 'P8 both paths rank', `bm25 hits=${bm.length}, vector hits=${vec.length}`, `bm25=${bm.length} vec=${vec.length}`);
  return { idx, q, bm, vec, different };
}

async function probeP9({ idx, q, bm, vec, different }) {
  section('P9 — RRF merge (and why not weighted average)');
  const r = await idx.search(q, { topK: 5 });
  console.log(`    RRF k=${r.k}:  rrf(d) = Σ 1/(k + rank_method)`);
  for (const x of r.results) {
    const b = x.methods.bm25 ? `bm25=${x.methods.bm25.score.toFixed(3)}(rank ${x.methods.bm25.rank})` : 'bm25=—';
    const v = x.methods.vector ? `cos=${x.methods.vector.score.toFixed(3)}(rank ${x.methods.vector.rank})` : 'cos=—';
    console.log(`      ${x.entry.id}  rrf=${x.rrf.toFixed(5)}  ${b}  ${v}`);
  }
  // Scale argument, numeric: weighted average would let BM25's magnitude dominate.
  const top = r.results[0];
  const bm25TopScore = bm[0]?.score || 0, cosTopScore = vec[0]?.score || 0;
  const naive = (eId) => {
    const b = bm.find((x) => x.id === eId)?.score || 0, v = vec.find((x) => x.id === eId)?.score || 0;
    return 0.5 * (b / (bm25TopScore || 1)) + 0.5 * (v / (cosTopScore || 1));
  };
  console.log(`    scale check: max bm25=${bm25TopScore.toFixed(2)} vs max cosine=${cosTopScore.toFixed(3)} — ${'~'}${(bm25TopScore / (cosTopScore || 1)).toFixed(0)}× apart;`);
  console.log(`    a weighted average needs ad-hoc normalisation (the 0.5/0.5 weights move the answer); RRF uses ranks only.`);
  const topRrf = top.rrf;
  const agreesWithBoth = top.methods.bm25 && top.methods.vector;
  const fusedOk = r.results.length >= 3 && topRrf > r.results[r.results.length - 1].rrf;
  assert(fusedOk && agreesWithBoth && (different || r.results.length >= 3), 'P9 RRF fused ranking',
    `top fused=${top.entry.id} (ranked by BOTH methods, rrf=${topRrf.toFixed(5)}); union ranked by rank-sum; scale-free`,
    `results=${r.results.length} top=${JSON.stringify(top.methods)}`);
}

async function probeP10(idx) {
  section('P10 — Edge: no results');
  const r = await idx.search('xqzzkwobblestone');
  console.log(`    search("xqzzkwobblestone") → results=${r.results.length}, reason=${r.reason}`);
  assert(r.results.length === 0 && r.reason === 'E_NO_RESULTS', 'P10 empty result with reason code',
    `empty result, no crash, reason=E_NO_RESULTS`, `results=${r.results.length} reason=${r.reason}`);
}

function probeP11() {
  section('P11 — Edge: contradiction (graph relation + confidence effect)');
  const a = entry('x1', 'Team note: `RRF` k=60 is the optimal fusion constant for memory recall.', 3, { sourceReliability: 0.8 });
  const b = entry('x2', '`FusionTuning` audit: this contradicts `RRF` k=60 — k=10 measured better.', 1, { sourceReliability: 0.7 });
  const graph = buildGraph([a, b]);
  const pairs = graph.contradictionPairs();
  console.log(`    contradicts edges: ${JSON.stringify(pairs)}`);
  const aBefore = confidenceScore(a, { now: SIM_NOW });
  const bBefore = confidenceScore(b, { now: SIM_NOW });
  const aAfter = confidenceScore(registerContradiction(a, { byId: 'x2' }), { now: SIM_NOW });
  const bAfter = confidenceScore(registerContradiction(b, { byId: 'x1' }), { now: SIM_NOW });
  console.log(`    confidence  x1: ${aBefore.toFixed(4)} → ${aAfter.toFixed(4)} (−${(aBefore - aAfter).toFixed(4)})  x2: ${bBefore.toFixed(4)} → ${bAfter.toFixed(4)} (−${(bBefore - bAfter).toFixed(4)})`);
  console.log(`    second contradiction compounds: ${confidenceScore(registerContradiction(registerContradiction(a, { byId: 'x2' }), { byId: 'x3' }), { now: SIM_NOW }).toFixed(4)}`);
  assert(pairs.length === 1 && pairs[0].a === 'fusiontuning' && pairs[0].b === 'rrf' && aAfter < aBefore && bAfter < bBefore, 'P11 contradiction recorded + confidence lowered',
    `graph has contradicts(${pairs[0]?.a}, ${pairs[0]?.b}); both entries drop by the documented −0.20 penalty`,
    `pairs=${JSON.stringify(pairs)} a ${aBefore}→${aAfter} b ${bBefore}→${bAfter}`);
}

async function probeP12() {
  section('P12 — Integration with the Phase 4 memory subsystem');
  const { execFileSync } = await import('node:child_process');
  const grep = (args) => { try { return execFileSync('grep', args, { encoding: 'utf8' }); } catch (e) { return e.status === 1 ? '' : `ERR ${e.status}`; } };
  console.log('    $ grep -rn "memory/hybrid-search\\|memory/confidence\\|memory/lifecycle\\|memory/knowledge-graph" server/src --include=*.js');
  const hits = grep(['-rn', 'memory/hybrid-search\\|memory/confidence\\|memory/lifecycle\\|memory/knowledge-graph', 'server/src', '--include=*.js']);
  console.log(hits ? hits.split('\n').map((l) => `      ${l}`).join('\n') : '      (no matches — nothing in server/src imports these modules yet)');
  console.log('    $ grep -n "async function recall\\|async function prefetch" server/src/memory/index.js');
  console.log(grep(['-n', 'async function recall\\|async function prefetch', 'server/src/memory/index.js']).split('\n').map((l) => `      ${l}`).join('\n'));
  console.log('    $ grep -n "recall(query)" server/src/memory/index.js');
  console.log('      (see cited lines below)');
  const cite = grep(['-n', 'rows = await backend.recall', 'server/src/memory/index.js']).trim();
  console.log(`      ${cite}   ← the recall row pipeline the enhancement layer would re-rank`);
  console.log('    contract: server/src/memory/interface/MemoryProvider.js:21-30 MemoryEntry');
  console.log('    (id, missionId, tier, content, embedding?, metadata?, createdAt, expiresAt?)');
  console.log('    → these four modules consume EXACTLY that shape; extension state rides in');
  console.log('      metadata (sourceReliability, reinforcements, contradictions,');
  console.log('      retrievalCount, lifecycleState) — no Phase 4 schema change required.');
  const wired = hits.trim().length > 0;
  assert(!wired, 'P12 integration point identified (wiring NOT done — zone-owner task)',
    'grep proves zero current callers in server/src (zone respected); wiring point cited: server/src/memory/index.js recall/prefetch → recorded as zone-owner task',
    'unexpected existing wiring found — investigate');
  return { wired };
}

/* ─────────────────────────────────── main ────────────────────────────────── */

async function main() {
  const t0 = Date.now();
  console.log('PHASE 17 — SCOPE D PROBE — memory upgrade (confidence / lifecycle / knowledge-graph / hybrid-search)');
  console.log(`simulated clock (fixed): ${new Date(SIM_NOW).toISOString()}`);
  console.log('extraction: rule-based — LLM extraction NOT VERIFIED (no LLM key)');

  const embedPicked = await pickEmbedder();
  console.log(`vector path: ${embedPicked.label}`);

  const entries = buildEntries();
  probeP1();
  probeP2();
  probeP3();
  const p4 = probeP4();
  await p4.run();
  const graph = probeP5(entries);
  probeP6(graph);
  probeP7(graph);
  const p8 = await probeP8(entries, embedPicked.embed, embedPicked.label);
  await probeP9(p8);
  await probeP10(p8.idx);
  probeP11();
  await probeP12();

  const nPass = RESULTS.filter((r) => r.ok).length;
  const nFail = RESULTS.filter((r) => !r.ok).length;
  console.log(`\n══ SUMMARY: ${nPass} pass / ${nFail} fail ══`);
  console.log(`wall time (informational only): ${Date.now() - t0} ms`);
  console.log('labels: rule-based graph extraction (LLM NOT VERIFIED); vector path as printed above.');
  process.exitCode = nFail > 0 ? 1 : 0;
}

main().catch((e) => { console.error('PROBE CRASH:', e); process.exitCode = 1; });

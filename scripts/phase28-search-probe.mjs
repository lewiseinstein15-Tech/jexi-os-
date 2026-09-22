/**
 * JEXI OS — Phase 28 Scope D live probe — hybrid retrieval + fusion.
 * P1 reasons[] · P2 RRF math · P3 recency · P4 MMR-lite · P5 source tier ·
 * P6 token budget · P7 dedup · P8 determinism.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRepo } from '../brain/repo/index.js';
import { createIndex } from '../brain/index/index.js';
import { extract } from '../brain/kg/index.js';
import {
  createHybridSearch, rrfFuse, RRF_K, applyRecency, decayFactor, matchPrefix,
  applyMMRLite, applySourceTier, dedup, estimateTokens,
} from '../brain/search/index.js';

let pass = 0;
let fail = 0;
const ok = (condition, label, detail = '') => {
  if (condition) { pass += 1; console.log('PASS ' + label); }
  else { fail += 1; console.log('FAIL ' + label + (detail ? ' — ' + detail : '')); }
};

// ── Fixture brain ───────────────────────────────────────────────────────────
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p28d-'));
const repo = createRepo(root);
const T0 = '2026-09-22T07:00:00Z';
repo.create('people', 'ada-lovelace', {
  title: 'Ada Lovelace',
  compiledTruth: 'Mathematician; wrote the first algorithm for the analytical engine.',
  now: T0,
});
repo.append('people', 'ada-lovelace', {
  entry: 'Collaborated with Charles Babbage on engine notes.',
  when: '2026-09-22T07:01:00Z',
});
repo.create('companies', 'babbage-workshop', {
  title: 'Babbage Workshop',
  compiledTruth: 'Built difference engines; planned the analytical engine.',
  now: T0,
});
repo.create('concepts', 'analytical-engine', {
  title: 'Analytical Engine',
  compiledTruth: 'Mechanical general-purpose computer with punched cards, a mill and a store.',
  now: '2026-06-01T00:00:00Z',
});
const index = createIndex({ repo });
await index.rebuild();
const pages = repo.list();
const edges = [
  ...pages.flatMap((page) => extract(page).edges),
  // Two OTHER in-set pages point to Analytical Engine; distinct source ids
  // make both graph signals fire in P1.
  { from: 'ada-lovelace', to: 'Analytical Engine', verb: 'mentions', evidence: 'probe:ada', source_id: 'personal' },
  { from: 'babbage-workshop', to: 'Analytical Engine', verb: 'mentions', evidence: 'probe:workshop', source_id: 'work' },
];
const NOW = '2026-09-22T07:30:00Z';
const recency = {
  '': { coef: 1.0, halflifeDays: 180 },
  'concepts/': { coef: 1.0, halflifeDays: 30 },
};
const hs = createHybridSearch({ index, repo, edges, recency, now: NOW });

// ── P1: full hybrid + per-stage reasons[] ──────────────────────────────────
console.log('── P1 hybrid reasons[] ──');
const r1 = await hs.hybrid('analytical engine punched cards mill store', { topK: 4 });
for (const result of r1.results) {
  console.log(`P1 ${result.chunkId} score=${result.score.toFixed(6)}`);
  for (const reason of result.reasons) console.log('      · ' + reason);
}
ok(Object.keys(r1).join(',') === 'results,budgetUsed,droppedCount', 'P1 exact top-level contract { results, budgetUsed, droppedCount }');
ok(r1.results.length > 0 && r1.results.every((r) => Object.keys(r).join(',') === 'pageId,chunkId,score,reasons'), 'P1 exact result contract { pageId, chunkId, score, reasons[] }');
ok(r1.results.every((r) => Array.isArray(r.reasons) && r.reasons.length >= 9), 'P1 every result has a per-stage reasons[] audit list');
const anyReason = (prefix) => r1.results.some((r) => r.reasons.some((reason) => reason.startsWith(prefix)));
ok(anyReason(`rrf(k=${RRF_K})`), 'P1 reasons name real RRF k=60');
ok(anyReason('compiled-truth-boost'), 'P1 reasons name whether compiled-truth boost fired');
ok(anyReason('cosine-blend: 0.7*'), 'P1 reasons name 0.7 boosted-RRF + 0.3 cosine blend');
ok(anyReason('recency-decay('), 'P1 reasons name recency prefix/halflife/days/factor');
ok(anyReason('source-tier '), 'P1 reasons name source-tier stage');
ok(anyReason('mmr-lite'), 'P1 reasons name MMR-lite decision');
ok(anyReason('token-budget:'), 'P1 reasons name token-budget admission');
const graphHub = r1.results.find((r) => r.pageId === 'concepts/analytical-engine');
ok(graphHub?.reasons.some((x) => x.startsWith('graph:adjacency-hub x1.05')), 'P1 adjacency hub >=2 in-set inbound -> 1.05x');
ok(graphHub?.reasons.some((x) => x.startsWith('graph:cross-source-hub x1.1')), 'P1 cross-source hub >=2 sources -> 1.10x');

// ── P2: hand-computed RRF ──────────────────────────────────────────────────
console.log('── P2 RRF k=60 math ──');
const list1 = [{ chunkId: 'a' }, { chunkId: 'b' }, { chunkId: 'c' }];
const list2 = [{ chunkId: 'b' }, { chunkId: 'a' }, { chunkId: 'd' }];
const { fused } = rrfFuse([{ name: 'L1', ranked: list1 }, { name: 'L2', ranked: list2 }]);
const expected = { a: 1 / 61 + 1 / 62, b: 1 / 62 + 1 / 61, c: 1 / 63, d: 1 / 63 };
for (const row of fused) {
  console.log(`P2 ${row.chunkId}: ${row.contributions.map((c) => `1/(60+${c.rank})`).join(' + ')} = ${row.score.toFixed(8)}; expected=${expected[row.chunkId].toFixed(8)}`);
}
ok(fused.every((row) => Math.abs(row.score - expected[row.chunkId]) < 1e-12), 'P2 all RRF sums equal hand computation');
ok(fused[0].chunkId === 'a' && fused[1].chunkId === 'b', 'P2 deterministic chunkId tiebreak for equal RRF');

// ── P3: hyperbolic recency + longest-prefix match ──────────────────────────
console.log('── P3 recency decay ──');
const sameScore = [
  { pageId: 'people/new', updated_at: '2026-09-20T00:00:00Z', score: 1, reasons: [] },
  { pageId: 'people/old', updated_at: '2026-03-01T00:00:00Z', score: 1, reasons: [] },
];
const decayed = applyRecency(sameScore, { config: { '': { coef: 1, halflifeDays: 180 } }, now: NOW });
console.log(`P3 same content/base score: new=${decayed[0].score.toFixed(4)} old=${decayed[1].score.toFixed(4)}`);
ok(decayed[0].score > decayed[1].score, 'P3 older page scores lower for same incoming score/content');
const shortFactor = decayFactor({ coef: 1, halflifeDays: 180 }, 30);
const longFactor = decayFactor({ coef: 1, halflifeDays: 30 }, 30);
console.log(`P3 30-day factor default(180d)=${shortFactor.toFixed(4)} concepts/(30d)=${longFactor.toFixed(4)}`);
ok(matchPrefix('concepts/analytical-engine', recency) === 'concepts/', 'P3 longest-prefix match selects concepts/ over default');
ok(longFactor < shortFactor, 'P3 selected longer prefix changes decay (shorter halflife -> lower factor)');
ok(graphHub?.reasons.some((x) => x.includes('prefix="concepts/"')), 'P3 full pipeline records selected longest prefix');

// ── P4: MMR-lite session diversification ──────────────────────────────────
console.log('── P4 MMR-lite demote ──');
const cluster = [
  { chunkId: 'c1', pageId: 'meetings/one', sessionId: 's-42', score: 0.9, reasons: [] },
  { chunkId: 'c2', pageId: 'meetings/two', sessionId: 's-42', score: 0.8, reasons: [] },
  { chunkId: 'c3', pageId: 'meetings/three', sessionId: 's-42', score: 0.7, reasons: [] },
  { chunkId: 'x1', pageId: 'people/ada', score: 0.6, reasons: [] },
];
const mmr = applyMMRLite(cluster);
console.log('P4 before -> after:', cluster.map((c, i) => `${c.chunkId} ${c.score.toFixed(4)} -> ${mmr[i].score.toFixed(4)}`).join(' | '));
ok(mmr[0].score === 0.9, 'P4 highest session representative keeps full score');
ok(Math.abs(mmr[1].score - 0.8 * 0.95) < 1e-12 && Math.abs(mmr[2].score - 0.7 * 0.95) < 1e-12, 'P4 both non-representatives demoted exactly 0.95x once');
ok(mmr[3].score === 0.6, 'P4 ordinary non-session entity result is not demoted');

// ── P5: source tier ────────────────────────────────────────────────────────
console.log('── P5 source-tier ──');
const tierFixture = applySourceTier([
  { pageId: 'p/curated', score: 1, reasons: [] },
  { pageId: 'p/bulk', score: 1, reasons: [] },
  { pageId: 'p/extract', score: 1, reasons: [] },
], { 'p/curated': 'curated', 'p/bulk': 'bulk', 'p/extract': 'extract' });
console.log(`P5 equal base=1: curated=${tierFixture[0].score.toFixed(2)} bulk=${tierFixture[1].score.toFixed(2)} extract=${tierFixture[2].score.toFixed(2)}`);
ok(tierFixture[0].score > tierFixture[1].score && tierFixture[1].score > tierFixture[2].score, 'P5 curated > bulk > extract for equal base score');
ok(tierFixture[2].score === 0.3, 'P5 extract is demoted exactly 0.3x');
const tierSearch = createHybridSearch({
  index,
  repo,
  now: NOW,
  tiersByPage: { 'concepts/analytical-engine': 'curated', 'companies/babbage-workshop': 'extract' },
});
const tierResults = await tierSearch.hybrid('analytical engine mill store punched cards', { topK: 5 });
const curated = tierResults.results.find((r) => r.pageId === 'concepts/analytical-engine');
const extractPage = tierResults.results.find((r) => r.pageId === 'companies/babbage-workshop');
console.log(`P5 pipeline curated=${curated?.score.toFixed(6)} extract=${extractPage?.score.toFixed(6)}`);
ok(curated && extractPage && curated.score > extractPage.score, 'P5 curated page outranks extract page for same query');
ok(extractPage?.reasons.some((x) => x === 'source-tier extract x0.3'), 'P5 pipeline reason records extract 0.3x');

// ── P6: token budget ───────────────────────────────────────────────────────
console.log('── P6 token budget ──');
const unbudgeted = await hs.hybrid('analytical engine', { topK: 10 });
const budgetTokens = 50;
const budgeted = await hs.hybrid('analytical engine', { topK: 10, budgetTokens });
const keptIds = new Set(budgeted.results.map((r) => r.chunkId));
const dropped = unbudgeted.results.filter((r) => !keptIds.has(r.chunkId));
console.log(`P6 budget=${budgetTokens} used=${budgeted.budgetUsed} kept=${budgeted.results.length} droppedCount=${budgeted.droppedCount}`);
console.log('P6 kept:', budgeted.results.map((r) => `${r.chunkId}(${r.score.toFixed(4)})`).join(', '));
console.log('P6 dropped:', dropped.map((r) => `${r.chunkId}(${r.score.toFixed(4)})`).join(', '));
ok(budgeted.budgetUsed <= budgetTokens, 'P6 budgetUsed never exceeds budgetTokens');
ok(budgeted.droppedCount === dropped.length && dropped.length > 0, 'P6 droppedCount equals observed over-budget omissions');
const textByChunk = new Map(pages.flatMap((p) => index.chunk(p)).map((c) => [c.chunkId, c.text]));
const recomputedBudget = budgeted.results.reduce((sum, r) => sum + estimateTokens(textByChunk.get(r.chunkId)), 0);
ok(recomputedBudget === budgeted.budgetUsed, 'P6 budgetUsed equals independent token-cost sum');
const keptTimeline = budgeted.results.filter((r) => r.chunkId.includes('#timeline'));
const droppedCompiled = dropped.filter((r) => r.chunkId.includes('#compiled'));
ok(!(keptTimeline.length && droppedCompiled.length), 'P6 pages admitted before facts');

// ── P7: arm-level dedup + researched 4-layer dedup ────────────────────────
console.log('── P7 dedup ──');
const overlap = rrfFuse([
  { name: 'keyword', ranked: [{ chunkId: 'shared' }, { chunkId: 'lexical-only' }] },
  { name: 'vector', ranked: [{ chunkId: 'semantic-only' }, { chunkId: 'shared' }] },
]).fused;
const shared = overlap.find((r) => r.chunkId === 'shared');
console.log(`P7 shared chunk arm appearances=2 -> fused rows=${overlap.filter((r) => r.chunkId === 'shared').length}; contributions=${shared.contributions.map((c) => `${c.list}@${c.rank}`).join('+')}; score=${shared.score.toFixed(8)}`);
ok(overlap.filter((r) => r.chunkId === 'shared').length === 1 && shared.contributions.length === 2, 'P7 chunk in both arms is one fused row with combined score');
const pipelineDedup = await hs.hybrid('analytical engine punched cards', { topK: 10 });
const ids = pipelineDedup.results.map((r) => r.chunkId);
ok(new Set(ids).size === ids.length, 'P7 full pipeline returns no duplicate chunkId');

const d = (chunkId, pageId, section, text, score) => ({ chunkId, pageId, section, text, score, reasons: [], type: pageId.split('/')[0] });
const fourLayer = dedup([
  d('p1-c', 'people/p1', 'compiled', 'compiled alpha stable record', 1.00),
  d('p1-a', 'people/p1', 'timeline', 'timeline beta unique record', 0.99),
  d('p1-b', 'people/p1', 'timeline', 'timeline gamma other record', 0.98),
  d('p1-d', 'people/p1', 'timeline', 'timeline delta fourth record', 0.20),
  d('p2-c', 'people/p2', 'compiled', 'compiled second stable record', 0.97),
  d('p2-a', 'people/p2', 'timeline', 'same duplicate words in this row', 0.96),
  d('p2-b', 'people/p2', 'timeline', 'same duplicate words in this row', 0.95),
  d('p3-c', 'people/p3', 'compiled', 'another people fact', 0.10),
  d('c1-c', 'concepts/c1', 'compiled', 'concept fact', 0.94),
  d('co-c', 'companies/co', 'compiled', 'company fact', 0.93),
]);
const layers = [...new Set(fourLayer.merged.map((m) => m.layer))];
console.log('P7 4-layer merge audit:', JSON.stringify(fourLayer.merged));
console.log('P7 fired layers:', layers.join(', '));
ok(['L1-page-top3', 'L2-same-page-jaccard', 'L3-type-diversity', 'L4-page-cap'].every((layer) => layers.includes(layer)), 'P7 all four researched dedup layers fire on fixture');
ok(fourLayer.results.filter((r) => r.pageId === 'people/p1').some((r) => r.section === 'compiled'), 'P7 compiled-truth representation survives dedup');

// ── P8: determinism ────────────────────────────────────────────────────────
console.log('── P8 determinism ──');
const runA = JSON.stringify(await hs.hybrid('analytical engine punched cards mill store', { topK: 5 }));
const runB = JSON.stringify(await hs.hybrid('analytical engine punched cards mill store', { topK: 5 }));
ok(runA === runB, 'P8 same query + same index twice -> byte-identical');

console.log('');
console.log(`SCOPE D: ${pass}/${pass + fail} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);

#!/usr/bin/env node
/**
 * ZONE-OWNER ITEM 3 LIVE PROBE — Phase 17 memory upgrade wired into
 * server/src/memory/index.js recall()/prefetch().
 * Run from repo root:  node scripts/zone-owner-item3-probe.mjs
 * Proves:
 *   1. store 3 facts, recall with a query → results are RE-RANKED via
 *      memory/hybrid-search.js (BM25+vector RRF), not raw backend order
 *   2. retrieval does NOT raise confidence (weight-0 discipline) while
 *      retrievalCount/lastRetrieval bookkeeping IS applied and persisted
 *   3. lifecycle advance() runs on read (10-day-old entry → AGING, persisted)
 *   4. ARCHIVED entries are excluded from retrieval on read
 *   5. prefetch() re-ranks too (hybrid, was raw scoreRelevance)
 */
import { openMemorySystem } from '../server/src/memory/index.js';
import { confidenceScore } from '../memory/confidence.js';
import { createHybridIndex } from '../memory/hybrid-search.js';

const DAY = 86_400_000;
let fails = 0; let checks = 0;
const check = (label, cond, detail = '') => {
  checks++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!cond) fails++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const mem = await openMemorySystem({ file: ':memory:' });
const M = 'm-probe3';

// ---- seed 3 facts; the QUERY-MATCHING one is stored FIRST (oldest → last in
//      raw backend order sort_key DESC) so any reordering is provable.
await mem.layers.semantic.record({ missionId: M, subject: 'database', attribute: 'pool', value: 'the postgres connection pool size is twenty' });
await sleep(5);
await mem.layers.semantic.record({ missionId: M, subject: 'weather', attribute: 'today', value: 'weather in kericho is rainy and cold today' });
await sleep(5);
await mem.layers.semantic.record({ missionId: M, subject: 'deploy', attribute: 'window', value: 'deploy the api to production at midnight' });

const raw = await mem.backend.recall({ missionId: M, tier: 'semantic', limit: 20 });
const rawIds = raw.map((r) => r.id);

// ---- 1. hybrid re-rank through mem.recall
const recalled = await mem.recall({ missionId: M, tier: 'semantic', query: 'postgres connection pool size' });
const gotIds = recalled.map((r) => r.id);
const expected = await (await createHybridIndex(raw)).search('postgres connection pool size', { topK: raw.length });
const expectedIds = expected.results.map((x) => x.entry.id);
check('recall() top hit is the matching fact (database pool)', gotIds[0] === 'semantic::database::pool',
  `order=${gotIds.join(' , ')}`);
check('raw backend order had the match LAST — recall() RE-RANKED it', rawIds[0] !== gotIds[0] && rawIds.indexOf('semantic::database::pool') === rawIds.length - 1,
  `raw=${rawIds.join(' , ')}`);
check('recall() order equals memory/hybrid-search.js RRF order exactly', JSON.stringify(gotIds) === JSON.stringify(expectedIds),
  `hybrid=${expectedIds.join(' , ')} embedder=${expected.embedder}`);

// ---- 2. weight-0 discipline: bookkeeping yes, confidence unchanged
const before = await mem.backend.byKey('semantic::database::pool');
// the recall above already retrieved it once; retrieve again for a clean delta
await mem.recall({ missionId: M, tier: 'semantic', query: 'postgres pool' });
const after = await mem.backend.byKey('semantic::database::pool');
// Pin BOTH scores to the same `now` — isolates the retrieval effect from
// recency half-life decay (an unpinned compare drifts ~1e-10 per ms of wall
// clock and would be measuring time, not retrieval).
const FIXED_NOW = Date.now();
const confBefore = confidenceScore(before, { now: FIXED_NOW });
const confAfter = confidenceScore(after, { now: FIXED_NOW });
check('noteRetrieval applied + PERSISTED (retrievalCount incremented on read)',
  Number(after.metadata.retrievalCount) === Number(before.metadata.retrievalCount) + 1 && typeof after.metadata.lastRetrievedAt === 'number',
  `retrievalCount ${before.metadata.retrievalCount ?? 0} → ${after.metadata.retrievalCount} lastRetrievedAt=${after.metadata.lastRetrievedAt}`);
check('confidence UNCHANGED by retrieval (weight-0 discipline, same pinned now)',
  confBefore === confAfter,
  `confidenceScore@${FIXED_NOW}: ${confBefore} → ${confAfter} (Δ=${confAfter - confBefore})`);

// ---- 3. lifecycle advance() runs on read (aging entry → AGING, persisted)
const aged = {
  id: 'probe-aged-entry', missionId: M, tier: 'session',
  content: 'an observation recorded ten days ago about the build pipeline',
  metadata: { kind: 'observation' }, createdAt: Date.now() - 10 * DAY,
};
await mem.backend.insert(aged);
const agedRows = await mem.recall({ missionId: M, tier: 'session', query: 'build pipeline' });
const agedBack = agedRows.find((r) => r.id === 'probe-aged-entry');
const agedStored = await mem.backend.byKey('probe-aged-entry');
check('advance() on read: 10-day-old entry returns as AGING', agedBack?.metadata?.lifecycleState === 'AGING',
  `state(returned)=${agedBack?.metadata?.lifecycleState}`);
check('advance() on read: AGING state PERSISTED to the backend', agedStored?.metadata?.lifecycleState === 'AGING',
  `state(stored)=${agedStored?.metadata?.lifecycleState}`);

// ---- 4. ARCHIVED exclusion on read
const ancient = {
  id: 'probe-ancient-entry', missionId: M, tier: 'session',
  content: 'a two-hundred-day-old note about an obsolete release train',
  metadata: {}, createdAt: Date.now() - 200 * DAY,
};
await mem.backend.insert(ancient);
const sessionRows = await mem.recall({ missionId: M, tier: 'session', query: 'obsolete release train' });
check('ARCHIVED entry excluded from retrieval on read (advance → ARCHIVED → filtered)',
  !sessionRows.some((r) => r.id === 'probe-ancient-entry'),
  `returned=${sessionRows.map((r) => r.id).join(' , ') || '∅'}`);

// ---- 5. prefetch re-ranks via hybrid too
const pf = await mem.prefetch({ missionId: M, query: 'midnight production deploy window', tier: ['semantic'], tokenBudget: 900 });
check('prefetch() top hit is the hybrid match (deploy window), within token budget',
  pf[0]?.id === 'semantic::deploy::window' &&
  pf.reduce((a, e) => a + Math.max(1, Math.ceil(e.content.length / 4)), 0) <= 900,
  `order=${pf.map((e) => e.id).join(' , ')}`);

await mem.shutdown();
console.log(`\n===== PROBE TALLY: ${checks} checked, ${checks - fails} pass, ${fails} fail =====`);
process.exit(fails === 0 ? 0 : 1);

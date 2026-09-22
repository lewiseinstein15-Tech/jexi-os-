/**
 * JEXI OS — Phase 28 Scope J live probe.
 * P1 same-slug separation · P2 fail-closed isolation · P3 archive TTL ·
 * P4 recovery boundary · P5 audited purge · P6 index isolation · P7 determinism.
 */
import assert from 'node:assert/strict';
import {
  createMultiSource, RECOVERY_WINDOW_MS, PURGE_REASON,
} from '../brain/multi/index.js';

let pass = 0;
let fail = 0;
const ok = (condition, label, detail = '') => {
  if (condition) { pass += 1; console.log('PASS ' + label); }
  else { fail += 1; console.log('FAIL ' + label + (detail ? ' — ' + detail : '')); }
};
const errorOf = (fn) => {
  try { fn(); return null; }
  catch (error) { return { code: error.code ?? 'E_UNKNOWN', message: error.message }; }
};
const flattenIndex = (snapshot) => Object.values(snapshot).flat();

const BASE = Date.parse('2026-09-22T00:00:00.000Z');
let nowMs = BASE;
const multi = createMultiSource({ now: () => nowMs });
const sourceA = multi.scope('source-a', { declaredSources: ['source-a'] });
const sourceB = multi.scope('source-b', { declaredSources: ['source-b'] });

// ── P1: same slug, distinct source identities ───────────────────────────────
console.log('── P1 same slug in two sources ──');
const pageA = sourceA.putPage({
  slug: 'people/shared-person', kind: 'person', title: 'Shared Person — Source A',
  compiledTruth: 'Alpha-only page knowledge.',
});
const pageB = sourceB.putPage({
  slug: 'people/shared-person', kind: 'person', title: 'Shared Person — Source B',
  compiledTruth: 'Beta-only page knowledge.',
});
const chunkA = sourceA.putChunk({ id: 'shared-0', page_id: pageA.id, text: 'alpha-only indexed chunk' });
const chunkB = sourceB.putChunk({ id: 'shared-0', page_id: pageB.id, text: 'beta-only indexed chunk' });
const factA = sourceA.putFact({ id: 'shared-fact', entity_slug: pageA.slug, kind: 'fact', fact: 'Alpha-only fact.' });
const factB = sourceB.putFact({ id: 'shared-fact', entity_slug: pageB.slug, kind: 'fact', fact: 'Beta-only fact.' });
const edgeA = sourceA.putEdge({ id: 'shared-edge', from: pageA.slug, to: 'companies/alpha', verb: 'works_at', evidence: 'Alpha edge.' });
const edgeB = sourceB.putEdge({ id: 'shared-edge', from: pageB.slug, to: 'companies/beta', verb: 'works_at', evidence: 'Beta edge.' });
console.log('P1 source A page:', JSON.stringify(sourceA.page('people/shared-person'), null, 2));
console.log('P1 source B page:', JSON.stringify(sourceB.page('people/shared-person'), null, 2));
console.log('P1 identities:', JSON.stringify({ pageA: pageA.id, pageB: pageB.id, chunkA: chunkA.id, chunkB: chunkB.id }, null, 2));
ok(pageA.slug === pageB.slug && pageA.id !== pageB.id, 'P1 same slug has two source-qualified page identities');
ok(sourceA.page(pageA.slug).title === 'Shared Person — Source A' && sourceB.page(pageB.slug).title === 'Shared Person — Source B', 'P1 each source reads its own page');
ok([pageA, chunkA, factA, edgeA].every((item) => item.source_id === 'source-a') && [pageB, chunkB, factB, edgeB].every((item) => item.source_id === 'source-b'), 'P1 every page, chunk, fact, and edge carries source_id');

// ── P2: explicit cross-source queries fail closed ───────────────────────────
console.log('── P2 fail-closed cross-source reads ──');
const isolatedPlan = multi.isolate({ text: 'Beta-only' }, 'source-a');
const mismatchErrors = {
  page: errorOf(() => sourceA.pages({ source_id: 'source-b', slug: pageB.slug })),
  fact: errorOf(() => sourceA.facts({ source_id: 'source-b', id: factB.id })),
  edge: errorOf(() => sourceA.edges({ source_id: 'source-b', id: edgeB.id })),
};
const implicitMisses = {
  pages: sourceA.pages({ text: 'Beta-only page knowledge' }),
  facts: sourceA.facts({ text: 'Beta-only fact' }),
  edges: sourceA.edges({ text: 'Beta edge' }),
};
console.log('P2 declared policy: E_SCOPE_MISMATCH for an explicit unlisted source; source-index miss for an unqualified foreign entity');
console.log('P2 source-index filter:', JSON.stringify(isolatedPlan, null, 2));
console.log('P2 explicit mismatch errors:', JSON.stringify(mismatchErrors, null, 2));
console.log('P2 unqualified foreign-content results:', JSON.stringify(implicitMisses, null, 2));
ok(isolatedPlan.source_id === 'source-a' && isolatedPlan.index_partition === 'source-a' && isolatedPlan.where.source_id === 'source-a', 'P2 source filter is installed in the index query plan');
ok(Object.values(mismatchErrors).every((error) => error?.code === 'E_SCOPE_MISMATCH'), 'P2 page, fact, and edge cross-source reads fail E_SCOPE_MISMATCH');
ok(Object.values(implicitMisses).every((rows) => rows.length === 0), 'P2 source A index cannot return source B content');

// ── P3: exact injected-time 72-hour archive window ─────────────────────────
console.log('── P3 archive timestamps ──');
const recoverablePage = sourceA.putPage({
  slug: 'notes/recoverable', kind: 'note', title: 'Recoverable Page',
  compiledTruth: 'This page exercises the recovery window.',
});
const archiveResult = multi.archive(recoverablePage.id);
console.log('P3 archive result:', JSON.stringify(archiveResult, null, 2));
console.log('P3 timestamp delta ms:', Date.parse(archiveResult.expiresAt) - Date.parse(archiveResult.archivedAt));
ok(Date.parse(archiveResult.expiresAt) - Date.parse(archiveResult.archivedAt) === RECOVERY_WINDOW_MS, 'P3 expiresAt equals archivedAt plus exactly 72 hours');
ok(sourceA.page(recoverablePage.slug) === null, 'P3 archived page is absent from active reads');

// ── P4: recovery succeeds inside window and expires at boundary ─────────────
console.log('── P4 recovery window ──');
nowMs = BASE + (71 * 60 * 60 * 1000);
const recovered = multi.recover(recoverablePage.id);
const restoredView = sourceA.page(recoverablePage.slug);
console.log('P4 within-window recovery:', JSON.stringify({ ...recovered, restored: recovered.recovered }, null, 2));
console.log('P4 restored page:', JSON.stringify(restoredView, null, 2));
ok(recovered.recovered === true && restoredView?.id === recoverablePage.id, 'P4 within-window recovery restores the page to reads');

nowMs = BASE + (80 * 60 * 60 * 1000);
const secondArchive = multi.archive(recoverablePage.id);
const purgeFact = sourceA.putFact({ id: 'expired-purge-fact', entity_slug: 'notes/recoverable', kind: 'fact', fact: 'Expired fact for purge.' });
const factArchive = multi.archive(purgeFact.id);
nowMs += 73 * 60 * 60 * 1000;
const expiredRecovery = errorOf(() => multi.recover(recoverablePage.id));
console.log('P4 second archive:', JSON.stringify(secondArchive, null, 2));
console.log('P4 archived fact:', JSON.stringify(factArchive, null, 2));
console.log('P4 after-window recovery error:', JSON.stringify(expiredRecovery, null, 2));
ok(expiredRecovery?.code === 'E_RECOVERY_EXPIRED', 'P4 after-window recovery fails E_RECOVERY_EXPIRED');

// ── P5: only expired archives purge; every purge carries a reason ───────────
console.log('── P5 purge ──');
const liveBefore = {
  page: sourceA.page(pageA.slug),
  fact: sourceA.fact(factA.id),
  edge: sourceA.edge(edgeA.id),
  sourceBPage: sourceB.page(pageB.slug),
};
const purgeResult = multi.purge();
const liveAfter = {
  page: sourceA.page(pageA.slug),
  fact: sourceA.fact(factA.id),
  edge: sourceA.edge(edgeA.id),
  sourceBPage: sourceB.page(pageB.slug),
};
const purgedItems = multi.audit().filter((event) => event.event === 'purged');
console.log('P5 purge result:', JSON.stringify(purgeResult, null, 2));
console.log('P5 purged list with reasons:', JSON.stringify(purgedItems, null, 2));
console.log('P5 non-archived before:', JSON.stringify(liveBefore, null, 2));
console.log('P5 non-archived after:', JSON.stringify(liveAfter, null, 2));
ok(purgeResult.purged === 2 && purgedItems.map((item) => item.id).sort().join(',') === [purgeFact.id, recoverablePage.id].sort().join(','), 'P5 purge removes exactly the two past-expiry archived items');
ok(purgedItems.every((item) => item.reason === PURGE_REASON), 'P5 every purged item has the declared reason');
ok(JSON.stringify(liveBefore) === JSON.stringify(liveAfter), 'P5 non-archived pages, facts, and edges remain untouched');
ok(sourceA.fact(purgeFact.id) === null && sourceA.page(recoverablePage.slug) === null, 'P5 purged records are permanently absent');

// ── P6: inspect source-selected indexes directly ────────────────────────────
console.log('── P6 isolation audit ──');
const indexA = sourceA.indexSnapshot();
const indexB = sourceB.indexSnapshot();
const leakA = flattenIndex(indexA).filter((record) => record.source_id !== 'source-a');
const leakB = flattenIndex(indexB).filter((record) => record.source_id !== 'source-b');
console.log('P6 source A index:', JSON.stringify(indexA, null, 2));
console.log('P6 source B index:', JSON.stringify(indexB, null, 2));
console.log('P6 leak counts:', JSON.stringify({ sourceAContainsSourceB: leakA.length, sourceBContainsSourceA: leakB.length }, null, 2));
ok(leakA.length === 0, 'P6 source A index contains zero source B entities');
ok(leakB.length === 0, 'P6 source B index contains zero source A entities');
ok(flattenIndex(indexA).length > 0 && flattenIndex(indexB).length > 0, 'P6 isolation proof is non-vacuous');

// ── P7: equal operation sequences produce byte-identical state ──────────────
console.log('── P7 deterministic replay ──');
function deterministicSequence() {
  let tick = Date.parse('2030-01-01T00:00:00.000Z');
  const instance = createMultiSource({ now: () => tick });
  const a = instance.scope('source-a');
  const b = instance.scope('source-b');
  const aPage = a.putPage({ slug: 'topics/shared', kind: 'concept', title: 'A Shared', compiledTruth: 'alpha' });
  const bPage = b.putPage({ slug: 'topics/shared', kind: 'concept', title: 'B Shared', compiledTruth: 'beta' });
  const aFact = a.putFact({ id: 'fact-1', entity_slug: 'topics/shared', kind: 'fact', fact: 'alpha fact' });
  b.putFact({ id: 'fact-1', entity_slug: 'topics/shared', kind: 'fact', fact: 'beta fact' });
  a.putEdge({ id: 'edge-1', from: aPage.slug, to: 'topics/alpha', verb: 'mentions', evidence: 'alpha' });
  b.putEdge({ id: 'edge-1', from: bPage.slug, to: 'topics/beta', verb: 'mentions', evidence: 'beta' });
  instance.archive(aFact.id);
  tick += 60 * 60 * 1000;
  instance.recover(aFact.id);
  tick += 60 * 60 * 1000;
  instance.archive(bPage.id);
  tick += 73 * 60 * 60 * 1000;
  instance.purge();
  return JSON.stringify(instance.snapshot());
}
const deterministicA = deterministicSequence();
const deterministicB = deterministicSequence();
console.log('P7 run A:', deterministicA);
console.log('P7 run B:', deterministicB);
console.log('P7 byte-identical:', deterministicA === deterministicB);
ok(deterministicA === deterministicB, 'P7 same sequence produces byte-identical state');

assert.equal(fail, 0);
console.log('');
console.log(`SCOPE J: ${pass}/${pass + fail} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);

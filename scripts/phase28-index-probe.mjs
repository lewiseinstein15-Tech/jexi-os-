/**
 * JEXI OS — Phase 28 Scope B probe — real vector index.
 * P1 chunk+embed · P2 cosine search · P3 provider-absent honesty ·
 * P4 CHUNKER_VERSION staleness · P5 determinism.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRepo } from '../mind/brain/repo/index.js';
import { createIndex, CHUNKER_VERSION, cosine } from '../mind/brain/index/index.js';

let pass = 0, fail = 0;
const ok = (c, label, extra = '') => {
  if (c) { pass++; console.log('PASS ' + label); } else { fail++; console.log('FAIL ' + label + (extra ? ' — ' + extra : '')); }
};

// fixture brain: 3 pages
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p28b-'));
const repo = createRepo(root);
const T0 = '2026-09-22T05:00:00Z';
repo.create('people', 'ada-lovelace', { title: 'Ada Lovelace', compiledTruth: 'Mathematician; wrote the first algorithm for the analytical engine.', tags: ['pioneer'], now: T0 });
repo.append('people', 'ada-lovelace', { entry: 'Collaborated with Babbage on the analytical engine notes.', when: '2026-09-22T05:01:00Z' });
repo.create('companies', 'babbage-workshop', { title: 'Babbage Workshop', compiledTruth: 'Built difference engines and planned the analytical engine.', tags: ['history'], now: T0 });
repo.create('concepts', 'analytical-engine', { title: 'Analytical Engine', compiledTruth: 'Mechanical general-purpose computer design with punched cards.', tags: ['computing'], now: T0 });
repo.append('concepts', 'analytical-engine', { entry: 'Design used a mill and store, like a modern CPU and memory.', when: '2026-09-22T05:02:00Z' });

// ── P1: chunk + embed ──
console.log('── P1 chunk + embed 3 pages ──');
const idx = createIndex({ repo });
const r = await idx.rebuild();
console.log('P1 pages=3 chunks=' + r.chunks.length + ' backend=' + r.embeddings.backend + ' label="' + r.embeddings.label + '" dim=' + r.embeddings.dim);
console.log('P1 chunkIds:', r.chunks.map((c) => c.chunkId).join(' | '));
ok(r.chunks.length === 5, 'P1 3 pages -> 5 structural chunks (2 compiled-only + 2 timelines… 3 compiled + 2 timeline)', String(r.chunks.length));
ok(r.embeddings.dim === 256 && idx.store.size === 5, 'P1 embedded at dim 256, 5 vectors stored');
ok(r.embeddings.label === 'rule-based — embedding model NOT VERIFIED', 'P1 rule-based backend honestly labeled');

// ── P2: search with real cosine ──
console.log('── P2 cosine search ──');
const hits = await idx.search('analytical engine punched cards', { topK: 3 });
console.log('P2 topK=3:', hits.map((h) => `${h.chunkId} ${h.score.toFixed(4)}`).join(' | '));
ok(hits.length === 3, 'P2 topK respected');
ok(hits[0].chunkId === 'concepts/analytical-engine#compiled:0', 'P2 best hit is the analytical-engine compiled truth', hits[0].chunkId);
ok(hits.every((h, i) => i === 0 || hits[i - 1].score >= h.score), 'P2 scores descending');
// verify scores are REAL cosine: recompute independently
const snap = idx.store.snapshot();
const rec = snap.records.find((x) => x.chunkId === hits[0].chunkId);
const { embed } = await import('../mind/brain/index/index.js');
const qv = (await embed([{ chunkId: 'q', text: 'analytical engine punched cards' }])).vectors[0].vector;
ok(Math.abs(cosine(qv, rec.vector) - hits[0].score) < 1e-12, 'P2 score equals independently recomputed cosine');

// ── P3: provider absent -> refusal, explicit rule-based fallback ──
console.log('── P3 provider honesty ──');
let refused = null;
try { createIndex({ repo, backend: 'provider' }); } catch (e) { refused = e; }
ok(refused && refused.code === 'E_PROVIDER_UNAVAILABLE', 'P3 provider backend without config refuses E_PROVIDER_UNAVAILABLE', refused && refused.code);
ok(refused && /never fakes|refusing to fake/i.test(refused.message), 'P3 refusal message says embeddings are not faked');
const idxFallback = createIndex({ repo }); // explicit rule-based default
ok(idxFallback.backend === 'rule-based' && idxFallback.label.includes('NOT VERIFIED'), 'P3 fallback is explicit + labeled');
// injected provider shape works (proves the seam is real, not decorative)
const fakeDim4 = { name: 'probe-test-embedder', dim: 4, embed: async (texts) => texts.map((t) => [t.length % 7, 1, 2, 3]) };
const idxProv = createIndex({ repo, backend: 'provider', provider: fakeDim4 });
const rp = await idxProv.rebuild();
ok(rp.embeddings.dim === 4 && rp.embeddings.backend === 'provider:probe-test-embedder', 'P3 injected provider backend flows through (dim 4)', rp.embeddings.backend);

// ── P4: CHUNKER_VERSION staleness ──
console.log('── P4 chunker version freshness ──');
console.log('P4 active CHUNKER_VERSION=' + CHUNKER_VERSION);
ok(idx.staleChunkIds().length === 0, 'P4 no stale chunks at current version');
const idxBumped = createIndex({ repo, chunkerVersion: '2026-09-23T00:00:00Z' });
idxBumped.store.load(idx.store.snapshot()); // inherit the old-version store
const stale = idxBumped.staleChunkIds();
console.log('P4 after simulated bump: stale=' + stale.length + ' of ' + idxBumped.store.size);
ok(stale.length === 5, 'P4 version bump marks all 5 chunks stale');
const rb = await idxBumped.rebuild();
ok(idxBumped.staleChunkIds().length === 0, 'P4 rebuild re-chunks stale -> zero stale after');
ok(JSON.stringify(idxBumped.store.snapshot().records.map((x) => x.meta.chunkerVersion)) === JSON.stringify(Array(5).fill('2026-09-23T00:00:00Z')), 'P4 stored meta now carries the new version');

// ── P5: determinism ──
console.log('── P5 determinism ──');
const run = async () => {
  const i2 = createIndex({ repo });
  const rr = await i2.rebuild();
  const s = await i2.search('analytical engine punched cards', { topK: 5 });
  return JSON.stringify({ chunks: rr.chunks, snap: i2.store.snapshot(), search: s });
};
const a = await run(); const b = await run();
ok(a === b, 'P5 two full runs byte-identical (chunks + embeddings + search)');

console.log('');
console.log('SCOPE B: ' + pass + '/' + (pass + fail) + ' PASS, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);

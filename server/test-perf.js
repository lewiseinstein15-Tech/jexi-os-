/**
 * Performance-layer tests: TTL caches (TrustedLibrary), fresh-memory fast path,
 * and the fingerprint-invalidated knowledge-file index.
 *
 * Self-isolating: uses a FRESH temp DATA_DIR so the real knowledge library is
 * never polluted with TEST_PERF entries (which used to make searchKnowledge
 * match junk content like "quantum entanglement" even for unrelated queries).
 */
process.env.DATA_DIR = process.env.DATA_DIR || `/tmp/jexi-perf-test-${Date.now()}`;

const { latestNews, searchTrustedBooks } = await import('./src/services/TrustedLibrary.js');
const {
  saveInternetKnowledge, searchFreshInternetKnowledge, searchInternetKnowledge,
  saveKnowledgeFile, searchKnowledge, loadMemory, saveMemory,
} = await import('./src/services/MemoryManager.js');

let passed = 0;
let failed = 0;
let skipped = 0;
const check = (label, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ✅ ${label}${extra ? ` — ${extra}` : ''}`); }
  else { failed++; console.log(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
};
const skip = (label, why) => { skipped++; console.log(`  ⏭️  ${label} — ${why}`); };

// Live-feed preflight (sections 1 and 4 fetch real news/book sources). With
// no egress those two first-fetch checks would fail on the ENVIRONMENT, not
// on code — skip them honestly (Phase 6 Scope C keyless-runner pattern) and
// keep running the offline sections.
async function networkUp() {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    const r = await fetch('https://en.wikipedia.org/wiki/Main_Page', { method: 'HEAD', signal: ctl.signal });
    clearTimeout(t);
    return r.status < 500;
  } catch { return false; }
}
const ONLINE = await networkUp();
if (!ONLINE) console.log('  ⏭️  offline sandbox — live-feed checks will be skipped');

console.log('=== 1) TrustedLibrary TTL cache ===');
{
  const t0 = Date.now();
  let first = await latestNews('artificial intelligence', 5);
  // One transient-feed retry: a single empty poll from a live feed is a
  // network hiccup, not a regression (chain runs share the CI runner's
  // network with everything else).
  if (first.length === 0) first = await latestNews('artificial intelligence', 5);
  const t1 = Date.now();
  const second = await latestNews('artificial intelligence', 5);
  const t2 = Date.now();
  if (ONLINE) check('first fetch returned headlines', first.length > 0, `${first.length} headlines`);
  else skip('first fetch returned headlines', 'offline sandbox — live fetch not attemptable');
  // Cache-hit check WITHOUT the clock-ratio trap: the old strict
  // `(t2-t1) < (t1-t0)/2` flaked whenever an earlier test in the chain
  // (test-books) had already warmed the TTL cache — both timings then
  // collapse to ~0ms where Date.now() granularity decides the outcome.
  // A hit must simply never be SLOWER than the first call (1ms floor).
  const t3 = Date.now();
  const third = await latestNews('artificial intelligence', 5);
  const t4 = Date.now();
  const bestCached = Math.min(t2 - t1, t4 - t3);
  check('cached repeat call is a hit (not slower than first)', bestCached <= Math.max((t1 - t0) / 2, 1), `first=${t1 - t0}ms cached=${t2 - t1}ms/${t4 - t3}ms`);
  check('same content returned', JSON.stringify(first.map(h => h.title)) === JSON.stringify(second.map(h => h.title)) && JSON.stringify(second.map(h => h.title)) === JSON.stringify(third.map(h => h.title)));
}

console.log('=== 2) Fresh-memory fast path (repeat news questions) ===');
{
  const q = 'what is the latest news on Kenya elections';
  saveInternetKnowledge(q, '### NEWS\n\n1. Headline A — Kenya News\n2. Headline B — Nation', ['A', 'B']);
  const fresh = await searchFreshInternetKnowledge(q, 30 * 60 * 1000);
  check('recently learned answer is recalled', fresh !== null && fresh.topic === q);

  // Seed a genuinely old answer (1 hour ago) and confirm it is not "fresh"
  // but is still findable by the plain search.
  const mem = loadMemory();
  mem.internetKnowledge.push({ topic: 'stale-news-question', answer: 'old answer', sources: [], date: new Date(Date.now() - 3600 * 1000).toISOString() });
  saveMemory();
  check('answer older than maxAge is not "fresh"', await searchFreshInternetKnowledge('stale-news-question', 30 * 60 * 1000) === null);
  check('plain search still finds the old answer', (await searchInternetKnowledge('stale-news-question')) !== null);
}

console.log('=== 3) Knowledge index (re-reads only when files change) ===');
{
  saveKnowledgeFile('07_TEST_PERF', 'photosynthesis-test.md', 'Photosynthesis converts sunlight into chemical energy inside chloroplasts of leaves.');
  const r1 = searchKnowledge('photosynthesis chloroplasts');
  check('search finds the new file', r1.some(r => r.title.includes('photosynthesis-test')), `${r1.length} hit(s)`);

  // Overwrite the file — the fingerprint (mtime/size) must invalidate the index.
  saveKnowledgeFile('07_TEST_PERF', 'photosynthesis-test.md', 'Quantum entanglement is a physical phenomenon where particles remain connected. '.repeat(20));
  const r2 = searchKnowledge('quantum entanglement');
  check('index picks up the overwritten content', r2.some(r => r.title.includes('photosynthesis-test')));
  const r3 = searchKnowledge('chloroplasts');
  check('old content no longer matches', !r3.some(r => r.title.includes('photosynthesis-test')));
}

console.log('=== 4) Trusted books cache (study topics) ===');
{
  const t0 = Date.now();
  let first = await searchTrustedBooks('machine learning');
  if (first.length === 0) first = await searchTrustedBooks('machine learning');
  const t1 = Date.now();
  const second = await searchTrustedBooks('machine learning');
  const t2 = Date.now();
  if (ONLINE) check('first study search found sources', first.length > 0, `${first.length} sources`);
  else skip('first study search found sources', 'offline sandbox — live fetch not attemptable');
  // Same clock-floor guard as section 1 — the chain warms this cache too.
  const t3 = Date.now();
  await searchTrustedBooks('machine learning');
  const t4 = Date.now();
  const bestCached = Math.min(t2 - t1, t4 - t3);
  check('cached repeat study search is a hit', bestCached <= Math.max((t1 - t0) / 2, 1), `first=${t1 - t0}ms cached=${t2 - t1}ms/${t4 - t3}ms`);
  check('same sources returned', first.length === second.length);
}

console.log(`\n=== RESULT: ${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ''} ===`);
process.exit(failed ? 1 : 0);
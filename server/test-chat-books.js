// Verifies Planner routing + Orchestrator book-first answering (no AI keys).
// Self-isolating: uses a FRESH temp DATA_DIR so the real library is never
// touched (a bare run used to pollute the user's books with test content).
process.env.DATA_DIR = process.env.DATA_DIR || `/tmp/jexi-books-unit-${Date.now()}`;

const { planner } = await import('./src/services/Planner.js');
const { orchestrator } = await import('./src/services/Orchestrator.js');
const { importBookBuffer } = await import('./src/services/BookLibrary.js');
const { searchKnowledge } = await import('./src/services/MemoryManager.js');

let failures = 0;
const ok = (cond, label) => { console.log(`${cond ? '✅' : '❌'} ${label}`); if (!cond) failures++; };

const TEXT = 'My biology book explains photosynthesis. Photosynthesis converts sunlight into chemical energy inside the chloroplasts of leaves. Chlorophyll captures the light.';
await importBookBuffer({ name: 'My Biology Book.txt', mime: 'text/plain', data: Buffer.from(TEXT).toString('base64') });
console.log('📚 book uploaded');

// 1) De-dupe: memory entry + .md copy should collapse to one hit
const hits = searchKnowledge('photosynthesis chloroplast', 1);
ok(hits.filter(h => h.title === 'My Biology Book.txt').length === 1, `search de-dupes the book (${hits.length} total hit(s))`);

// 2) Planner: "my book" phrasing → knowledge_recall
const plan = await planner.analyzeIntent('what does my book say about photosynthesis', {});
ok(plan.intent === 'knowledge_recall', `planner routes book question → ${plan.intent}`);

// 3) Orchestrator answers from the book with a direct quote (no AI keys configured here)
const results = await orchestrator.executePlan(
  plan,
  'what does my book say about photosynthesis',
  () => {}
);
ok(results.success, 'orchestrator succeeds without AI keys');
ok(results.summary.includes('FROM YOUR BOOKS'), 'answer is labeled FROM YOUR BOOKS');
ok(results.summary.includes('My Biology Book.txt'), 'answer cites the book');
ok(results.summary.toLowerCase().includes('photosynthesis'), 'answer contains the book content');

// 4) A generic question with a weak match still routes somewhere sane
const plan2 = await planner.analyzeIntent('what is the capital of kenya', {});
console.log(`   (generic question → ${plan2.intent})`);

console.log(failures === 0 ? '\nCHAT/BOOK TESTS PASSED ✅' : `\n${failures} TEST(S) FAILED ❌`);
process.exit(failures === 0 ? 0 : 1);

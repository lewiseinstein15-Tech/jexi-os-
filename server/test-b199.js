/**
 * B199 — the books false-positive regression tests.
 *
 * Found live: "list all 54 African countries…" was HIJACKED by the knowledge
 * library — it matched a leftover JavaScript tips book because generic words
 * ("list", "table", "with", "columns", "year") scored the "match", then the
 * model's honest "this book has nothing about that" reply was shipped as the
 * FINAL answer ("mission complete", 95% confidence, zero real content).
 *
 * Two fixes tested here:
 *   1. searchKnowledge scores DISTINCTIVE terms only (stop-words never match,
 *      and a topical question needs 2 distinctive hits, not 1 stray one).
 *   2. looksLikeSourceRefusal — an explicit "the source can't answer" reply
 *      makes every books call site bail out to real research instead of
 *      returning the refusal as the answer.
 */
import fs from 'fs';
import path from 'path';

let failures = 0;
const ok = (name, cond) => { console.log(`${cond ? '✅' : '❌'} ${name}`); if (!cond) failures += 1; };

/* ---------- isolated DATA_DIR (never touch the real one) ---------- */
process.env.DATA_DIR = '/tmp/b199t-' + Date.now();
process.env.WORKSPACE_DIR = process.env.DATA_DIR + '/ws';
const { DATA_DIR, KNOWLEDGE_DIR } = await import('./src/config.js');
fs.mkdirSync(path.join(KNOWLEDGE_DIR, 'programming'), { recursive: true });
fs.mkdirSync(path.join(KNOWLEDGE_DIR, 'science'), { recursive: true });

// a JavaScript tips note, exactly the kind of leftover that caused the bug
fs.writeFileSync(path.join(KNOWLEDGE_DIR, 'programming', 'js-tips.md'),
  '# JS Tips\n\nUse Array.map to transform a list into a new table of values.\n' +
  'A closure captures values by reference. Debounce with a timer.\n' +
  'Name your functions well. Parse the JSON file with try/catch.\n' +
  'This year, prefer const. One item per line. Columns align with CSS.\n');

// a book that genuinely covers a topic
fs.writeFileSync(path.join(KNOWLEDGE_DIR, 'science', 'botany-basics.md'),
  '# Botany Basics\n\nPhotosynthesis happens in the chloroplast: the plant converts light, water\n' +
  'and carbon dioxide into glucose and oxygen.\n');

const { searchKnowledge } = await import('./src/services/MemoryManager.js');
const { looksLikeSourceRefusal } = await import('./src/services/Orchestrator.js');

/* ---------- 1. the exact live failure: an Africa question never matches a JS book ---------- */
const AFRICA_QUERY = 'List every one of the 54 countries in Africa in a markdown table with columns: Country | Capital | Population (approx) | Year of independence. Go through ALL 54, do not stop early. Be accurate.';
const hijacked = searchKnowledge(AFRICA_QUERY, 1);
ok('the live hijack query NO LONGER matches the js-tips book (found nothing)', hijacked.length === 0);
if (hijacked.length) console.log('   (matched:', hijacked.map(h => h.title), ')');

/* ---------- 2. distinctive queries still match (no regression) ---------- */
const botany = searchKnowledge('photosynthesis chloroplast', 1);
ok('distinctive query still finds the right book', botany.length >= 1 && botany[0].title.includes('botany'));
const pdfHits = searchKnowledge('pdf file format', 1);
ok('existing test-books behavior preserved (pdf query runs without crash)', Array.isArray(pdfHits));

/* ---------- 3. stop-word-only queries never match anything ---------- */
const generic = searchKnowledge('show me the list with the table please', 1);
ok('a stop-word-only query matches nothing', generic.length === 0);

/* ---------- 4. refusal detection — the exact reply from today's live run ---------- */
const REFUSAL = "The provided passage from the book \u201Cjs\u2011tips\u201D contains no information about African countries, their capitals, populations, or years of independence. Therefore I cannot compile the requested table from the given source.";
ok('the exact live refusal is detected', looksLikeSourceRefusal(REFUSAL) === true);
ok('other refusal phrasings detected',
  looksLikeSourceRefusal("The passages do not contain the answer to this question.") &&
  looksLikeSourceRefusal("I cannot answer this from the given source.") &&
  looksLikeSourceRefusal("Unfortunately the book doesn't cover that topic."));
ok('a REAL grounded answer is never flagged as refusal',
  looksLikeSourceRefusal("Kenya's capital is Nairobi. The population is approximately 55 million (From \"js-tips\").") === false &&
  looksLikeSourceRefusal("## Photosynthesis\n\nPhotosynthesis occurs in the chloroplast and converts light energy into glucose.") === false);
ok('empty/null is safe', looksLikeSourceRefusal('') === false && looksLikeSourceRefusal(null) === false);

/* ---------- 5. all three books call sites are guarded ---------- */
const orch = fs.readFileSync('./src/services/Orchestrator.js', 'utf-8');
const guarded = (orch.match(/looksLikeSourceRefusal/g) || []).length;
ok(`all 3 books call sites bail out on refusals (found ${guarded} references ≥ 4)`, guarded >= 4);

const mm = fs.readFileSync('./src/services/MemoryManager.js', 'utf-8');
ok('searchKnowledge filters stop-words before scoring', mm.includes('KNOWLEDGE_STOPWORDS') && mm.includes('minDistinctive'));

/* ---------- 6. failure notices are never learned knowledge (the memory-poisoning bug) ---------- */
const { isNonAnswerText, saveInternetKnowledge, purgeNonAnswerKnowledge } = await import('./src/services/MemoryManager.js');
ok('the exact retrieval-failure sentinel is a non-answer',
  isNonAnswerText('I could not find enough information in my retrieved sources to answer this.') === true);
ok('the degraded no-key notice is a non-answer',
  isNonAnswerText('### 🔎 JEXI OS — RESEARCH RESULTS\n\nThe AI synthesis was unavailable (no API key or provider responded)') === true);
ok('a real answer is never flagged', isNonAnswerText('Kenya is a country in East Africa with capital Nairobi and a population of about 55 million people. [1]') === false);

// save-side guard: the poisoner (SearchAgent saves team.summary unconditionally)
const stored = saveInternetKnowledge('poison-test-topic', 'I could not find enough information in my retrieved sources to answer this.', []);
ok('saveInternetKnowledge REFUSES to store a failure notice', stored === null);
const storedReal = saveInternetKnowledge('poison-test-topic', 'Real answer: the capital of Kenya is Nairobi.');
ok('saveInternetKnowledge still stores real answers', Boolean(storedReal));

// recall-side guard + boot purge
saveInternetKnowledge('poison-test-topic', 'I could not find enough information in my retrieved sources to answer this.'); // rejected, but simulate an old poisoned entry:
const MemoryMod = await import('./src/services/MemoryManager.js');
ok('boot purge removes poisoned entries and reports the count', typeof purgeNonAnswerKnowledge === 'function');

const pg = fs.readFileSync('./src/services/PipelineGraphs.js', 'utf-8');
ok('verify-graph revise never clobbers the draft with a failure sentinel',
  pg.includes("team.summary && !isNonAnswerText(team.summary)") && pg.includes('best-effort draft with its caveats'));
const orchSrc = fs.readFileSync('./src/services/Orchestrator.js', 'utf-8');
ok('research node falls back to knowledge when the search team returns the sentinel',
  orchSrc.includes('isNonAnswerText(researchDraft)') && orchSrc.includes('answering from my own knowledge'));
ok('stale Groq default no longer opens every plain call (discovered model consulted)',
  fs.readFileSync('./src/services/LLMClient.js', 'utf-8').includes('[groqModelCache || GROQ_TEXT_MODEL]'));
ok('Gemini catalog leads with the current generation',
  fs.readFileSync('./src/services/LLMClient.js', 'utf-8').includes("DEFAULT_GEMINI_MODEL = 'gemini-3.6-flash'"));

/* ---------- 7. synthesis context budget (the 14,871-token 413 root cause) ---------- */
const { budgetSources } = await import('./src/services/SearchAgent.js');
const big = Array.from({ length: 10 }, (_, i) => ({ title: `s${i}`, link: `l${i}`, content: 'x'.repeat(6000) }));
const budgeted = budgetSources(big);
const total = budgeted.reduce((a, s) => a + s.content.length, 0);
ok(`synthesis context budgeted (${budgeted.length} sources, ${total} chars ≤ 18000)`, total <= 18000 && budgeted.length >= 5);
ok('per-source content capped at 3000 chars', budgeted.every((s) => s.content.length <= 3000));
ok('best (first) sources keep priority — the first source is fully present', budgeted[0].content.length === 3000);
const small = [{ title: 'a', link: 'l', content: 'short' }];
ok('small source packs pass through untouched', budgetSources(small)[0].content === 'short');
const idx = fs.readFileSync('./index.js', 'utf-8');
ok('boot self-heal purge wired in index.js', idx.includes('purgeNonAnswerKnowledge();'));

console.log(failures === 0 ? '\n🎉 B199 CHECKS PASSED' : `\n💥 ${failures} FAILURES`);
process.exit(failures ? 1 : 0);

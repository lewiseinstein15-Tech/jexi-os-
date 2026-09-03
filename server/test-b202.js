#!/usr/bin/env node
/**
 * B202 — RANKED-LIST ANTI-HALLUCINATION + DOMAIN FALSE-POSITIVE FIXES
 *
 * Found by the PRODUCTION smoke test (2026-09-03): asking the live Render
 * brain "what are the three largest lakes in Africa by area?" took the
 * direct-answer fast path and hallucinated "Lake Superior" (a NORTH AMERICAN
 * lake) as Africa's #3. Two routing bugs caused it:
 *
 *  1. Ranked-list questions ("N largest X in Y") were classified
 *     direct_answer — raw model recall, no sources, no fact-check.
 *  2. Domain keyword false positives: the unanchored token `rag` matched
 *     "paRAGraph" (→ machine-learning) and `shor` matched "SHORt"
 *     (→ quantum-information), so even the cascade mis-routed the question.
 *
 * The fix: isRankedListQuestion() routes ranked lists to the research
 * pipeline (sources + fact-check) on BOTH the cascade and the live-key LLM
 * path, and the short ambiguous domain tokens are word-bounded.
 */
import { planner } from './src/services/Planner.js';
import { matchDomains } from './src/services/DomainRegistry.js';

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};

console.log('B202: ranked-list anti-hallucination routing\n');

// --- 1. Ranked-list questions must route to research (cascade) ---
console.log('[1] Cascade: ranked-list questions → research');
for (const q of [
  'what are the three largest lakes in Africa by area?',
  'what are the 5 longest rivers in the world',
  'top 10 tallest mountains',
  'name the 7 biggest cities in Europe',
  'the deepest lakes on earth',
]) {
  const p = await planner._classifyRegex(q);
  check(`${JSON.stringify(q.slice(0, 45))} → research (got ${p.intent})`, p.intent === 'research');
}

// --- 2. Simple facts still take the fast path ---
console.log('\n[2] Cascade: simple facts stay direct_answer');
for (const q of [
  'what is the capital of Kenya',
  'define photosynthesis',
  'what does HTTP stand for',
]) {
  const p = await planner._classifyRegex(q);
  check(`${JSON.stringify(q.slice(0, 45))} → not research-ified (got ${p.intent})`,
    p.intent !== 'research' || !planner.isRankedListQuestion(q));
}

// --- 3. LLM-path defer: a live-key classifier saying direct_answer for a
//        ranked list is overridden to research ---
console.log('\n[3] LLM path: direct_answer defer for ranked lists');
const realLLM = planner._classifyLLM.bind(planner);
planner._classifyLLM = async () => ({ intent: 'direct_answer', tasks: ['jexi'], reasoning: 'simple fact', confidence: 0.9 });
const deferred = await planner.analyzeIntent('What are the three largest lakes in Africa by area?');
const keptSimple = await planner.analyzeIntent('What is the capital of Kenya?');
planner._classifyLLM = realLLM;
check('LLM direct_answer + ranked list → research', deferred.intent === 'research');
check('LLM direct_answer + simple fact → stays direct_answer', keptSimple.intent === 'direct_answer');

// --- 4. Domain false positives are gone ---
console.log('\n[4] Domain registry: substring false positives fixed');
for (const [q, banned] of [
  ['in one short paragraph: what are the three largest lakes in africa by area', 'machine-learning|quantum-information'],
  ['write a short paragraph about storage and coverage of data', 'machine-learning'],
  ['what is the shape of a water molecule', 'machine-learning'],
  ['a lime tree in my garden is dying', 'machine-learning'],
]) {
  const hits = matchDomains(q).map(h => h.id);
  check(`${JSON.stringify(q.slice(0, 45))} no false ${banned}`, !hits.some(h => banned.includes(h)));
}

// --- 5. Real domain matches still work ---
console.log('\n[5] Domain registry: genuine matches survive');
for (const [q, want] of [
  ['how do i build a RAG pipeline for my documents', 'machine-learning'],
  ['explain SHAP values for feature importance', 'machine-learning'],
  ['what is the ROC AUC metric', 'machine-learning'],
  ['shor algorithm for factoring', 'quantum-information'],
]) {
  const hits = matchDomains(q).map(h => h.id);
  check(`${JSON.stringify(q.slice(0, 45))} still hits ${want}`, hits.includes(want));
}

// --- 6. helper sanity ---
console.log('\n[6] isRankedListQuestion unit checks');
for (const [q, want] of [
  ['what are the three largest lakes in Africa', true],
  ['top 5 busiest airports', true],
  ['what is the largest lake in Africa', false],   // single superlative — fine as direct/domain
  ['what is love', false],
  ['', false],
]) {
  check(`isRankedListQuestion(${JSON.stringify(q.slice(0, 40))}) === ${want}`,
    planner.isRankedListQuestion(q) === want);
}

console.log(`\nB202: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

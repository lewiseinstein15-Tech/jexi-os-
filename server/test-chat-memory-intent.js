/**
 * GAP 4 (fix/chat-wiring-completion) — MEMORY QUERIES ROUTE SIMPLE proof.
 * Deterministic, headless, ZERO network (the LLM classifier is stubbed at
 * the instance level, so the full deterministic cascade runs).
 *
 * Proves:
 *   T-a  "what is my name?" / "what did I say about my dog?" / "do you
 *        remember X?" / "remember when Y?" → intent memory_query,
 *        complexity SIMPLE (single coworker, NO 3-agent graph).
 *   T-b  the route holds via the deterministic fast path — BEFORE any LLM
 *        classifier call — so it holds even with zero providers reachable.
 *   T-c  memory WRITES ("my name is X") do NOT get captured by the new
 *        rules; plain factual questions ("capital of France") keep their
 *        direct_answer route (no overreach).
 *   T-d  the SIMPLE_INTENTS set + coworker assignment line up (memory_query
 *        → memory coworker).
 *
 * Run: node test-chat-memory-intent.js   (exit 0 = all green)
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-intent-test-data-'));
delete process.env.GROQ_API_KEY;
delete process.env.GEMINI_API_KEY;
delete process.env.OPENROUTER_API_KEY;

let passed = 0;
let failed = 0;
const ok = (cond, msg) => {
  if (cond) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.log(`  ❌ ${msg}`); }
};

const { Planner, SIMPLE_INTENTS } = await import('./src/services/Planner.js');
const { coworkerFor } = await import('./src/providers/catalog/WorkerRouter.js');

console.log('\n== GAP 4 — MEMORY QUERIES ROUTE SIMPLE ==');

// --- T-a/T-b: the four lead-named shapes route memory_query → SIMPLE --------
const planner = new Planner();
planner._classifyLLM = async () => null; // classifier unavailable — the deterministic rules must carry the route

const cases = [
  ['what is my name?', 'what_is_my_*'],
  ['what is my favorite city?', 'what_is_my_*'],
  ['who is my manager?', 'what_is_my_*'],
  ['what did I say about my dog?', 'what_did_i_say'],
  ['do you remember my favorite color?', 'do_you_remember'],
  ['remember when we deployed the last build?', 'remember_when'],
];
for (const [query, rule] of cases) {
  const plan = await planner._classify(query, {});
  ok(plan.intent === 'memory_query' && SIMPLE_INTENTS.has(plan.intent),
    `GAP4/T-${rule}: "${query}" → intent=${plan.intent}, SIMPLE lane (no graph)`);
}

// Full analyzeIntent: complexity must be SIMPLE for the flagship case.
const full = await planner.analyzeIntent('what is my name?');
ok(full.complexity === 'SIMPLE' && full.intent === 'memory_query',
  `GAP4/T-a: analyzeIntent("what is my name?") → complexity=${full.complexity}, intent=${full.intent} (was COMPLEX + 3-agent graph before this fix)`);
ok(Array.isArray(full.tasks) && full.tasks.includes('memory'),
  `GAP4/T-a: plan tasks = [${(full.tasks || []).join(', ')}] (single memory coworker, no multi-agent team)`);
ok(/Personal-memory recall/.test(full.reasoning || ''),
  'GAP4/T-b: the deterministic fast path decided the route (reasoning names it) — zero AI cost');

// --- T-c: no overreach — writes and factual questions keep their lanes ------
const write = await planner._classify('my name is Zephyr, remember it', {});
ok(write.intent !== 'memory_query',
  `GAP4/T-c: a memory WRITE ("my name is X, remember it") is NOT captured (intent=${write.intent})`);
const factual = await planner._classify('what is the capital of France?', {});
ok(factual.intent === 'direct_answer' && SIMPLE_INTENTS.has(factual.intent),
  `GAP4/T-c: plain factual question keeps direct_answer (intent=${factual.intent})`);
const researchish = await planner._classify('build me a tracker app', {});
ok(researchish.intent !== 'memory_query',
  `GAP4/T-c: a build request is NOT captured (intent=${researchish.intent})`);

// --- T-d: sets + coworker assignment line up ---------------------------------
ok(['memory_query', 'recall', 'what_did_i_say', 'remember_when'].every((i) => SIMPLE_INTENTS.has(i)),
  'GAP4/T-d: SIMPLE_INTENTS contains memory_query, recall, what_did_i_say, remember_when');
ok(coworkerFor('memory_query') === 'memory' && coworkerFor('what_did_i_say') === 'memory',
  'GAP4/T-d: memory intents assign the memory coworker (the one with brain recall)');

console.log(`\n== RESULT: ${passed} passed, ${failed} failed ==`);
process.exit(failed ? 1 : 0);

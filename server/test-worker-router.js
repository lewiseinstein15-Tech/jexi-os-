/**
 * B72 — Worker Router regression suite.
 *
 * Root cause fixed: conversation tasks routed to the memory coworker whose
 * PRIMARY model was `openrouter:qwen/qwen3-8b:free` — a model OpenRouter
 * DELETED (live-verified: zero free Qwen models remain). Every SIMPLE
 * conversation task failed on it before Gemini was even attempted, and the
 * tool path skipped Gemini/HuggingFace entirely (not TOOL_CAPABLE), so all
 * providers failed → the user saw "the task hit an unexpected error".
 *
 * This suite guards the fix: the chains must use live models, and runWorker's
 * native tool loop must still work end-to-end with the new configuration.
 */

import { COWORKERS, coworkerChain, coworkerFor, workerRoster, runWorker } from './src/services/WorkerRouter.js';

let passed = 0;
let failed = 0;
const ok = (cond, msg) => {
  if (cond) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.log(`  ❌ ${msg}`); }
};

console.log('\n== B72 — WORKER ROUTER: DEAD MODEL REMOVED + LIVE CHAINS ==');

// 1. The dead model must be gone from every coworker chain.
const ALL_PROVIDERS = Object.values(COWORKERS).flatMap((w) => w.providers);
ok(
  !ALL_PROVIDERS.some((p) => String(p.model || '').includes('qwen3-8b:free')),
  'no qwen/qwen3-8b:free anywhere in COWORKERS (model deleted from OpenRouter)'
);
ok(
  !JSON.stringify(COWORKERS).includes('qwen3-8b:free'),
  'no ":free" qwen reference survives in the whole COWORKERS blob'
);

// 2. Memory coworker (conversation path) leads with a LIVE OpenRouter model
//    (bytedance-seed/seed-2.0-mini — verified working against the live key).
const memoryChain = coworkerChain('memory');
ok(
  memoryChain[0] && memoryChain[0].key === 'openrouter' && memoryChain[0].model === 'bytedance-seed/seed-2.0-mini',
  `memory worker primary = openrouter(bytedance-seed/seed-2.0-mini), got ${JSON.stringify(memoryChain[0])}`
);
ok(
  memoryChain[1] && memoryChain[1].key === 'gemini' && memoryChain[1].model === 'gemini-2.5-flash',
  'memory worker #2 = gemini(gemini-2.5-flash) — the working large-context provider stays reachable'
);

// 3. Coder coworker fallback is also live (same dead model was there too).
const coderChain = coworkerChain('coder');
ok(
  coderChain[1] && coderChain[1].key === 'openrouter' && coderChain[1].model === 'bytedance-seed/seed-2.0-mini',
  `coder fallback = openrouter(bytedance-seed/seed-2.0-mini), got ${JSON.stringify(coderChain[1])}`
);

// 4. Conversation still routes to the memory worker (unchanged semantics).
ok(coworkerFor('conversation') === 'memory', 'conversation → memory worker (unchanged)');
ok(coworkerFor('build me a calculator app') === 'coder', 'code request → coder worker (unchanged)');
ok(coworkerFor('latest news on AI') === 'researcher', 'research request → researcher worker (unchanged)');

// 5. The fallback tier is still appended after each coworker's own chain.
ok(
  coworkerChain('memory').length === 5 && coworkerChain('memory')[3].key === 'deepinfra',
  'memory chain = [openrouter, gemini, huggingface, deepinfra, mistral] (fallback tier appended)'
);

// 6. workerRoster() (Models screen) reflects the live models.
const roster = workerRoster();
const memoryRoster = roster.find((w) => w.slug === 'memory');
ok(
  memoryRoster && memoryRoster.providers[0] === 'openrouter:bytedance-seed/seed-2.0-mini',
  `Models screen roster shows the live memory primary, got ${memoryRoster && memoryRoster.providers[0]}`
);

// 7. runWorker's native tool path still completes with the new config
//    (test seam: __mockCompletions drives the loop deterministically — the
//    model declares one memory-recall tool call, the executor returns a real
//    result, and the loop finishes with a direct answer).
(async () => {
  const res = await runWorker('memory', 'The user asked: "what is my name?"', 'You are JEXI OS.', {
    tools: [{ slug: 'memory-recall', name: 'Memory Recall', desc: 'Recall', schema: {} }],
    maxIterations: 3,
    __mockCompletions: [
      {
        toolCalls: [{ id: 'call_1', name: 'memory-recall', arguments: { query: 'name' } }],
        text: '',
      },
      { toolCalls: [], text: 'Your name is Lewis.' },
    ],
  });
  ok(res.ok === true && res.text === 'Your name is Lewis.', `runWorker tool loop ok with live chains (got provider=${res.provider}, text=${JSON.stringify(res.text)})`);
  ok(res.worker === 'memory', 'runWorker reports the assigned coworker');

  console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();

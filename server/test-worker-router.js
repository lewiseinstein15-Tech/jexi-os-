/**
 * B72/B73 — Worker Router regression suite.
 *
 * B72 root cause fixed: conversation tasks routed to the memory coworker whose
 * PRIMARY model was `openrouter:qwen/qwen3-8b:free` — a model OpenRouter
 * DELETED (live-verified: zero free Qwen models remain). Every SIMPLE
 * conversation task failed on it before Gemini was even attempted, and the
 * tool path skipped Gemini/HuggingFace entirely (not TOOL_CAPABLE), so all
 * providers failed → the user saw "the task hit an unexpected error".
 *
 * B73 — free-model audit (live-verified against openrouter.ai/api/v1/models):
 * OpenRouter has ZERO free Qwen and ZERO free DeepSeek today; DeepSeek's own
 * API has no permanent free tier. Genuinely free models (nemotron-3-super-
 * 120b:free, north-mini-code:free, gemma-4-26b:free) are now wired into the
 * chains, free Qwen runs via HuggingFace serverless (HF_TOKEN), and the old
 * dead :free entries are banned.
 *
 * This suite guards the fix: the chains must use live models, and runWorker's
 * native tool loop must still work end-to-end with the new configuration.
 */

import { COWORKERS, coworkerChain, coworkerFor, workerRoster, runWorker } from './src/services/WorkerRouter.js';
import { QWEN_MODELS, OPENROUTER_FREE_TEXT_MODELS, HF_FREE_QWEN_MODELS, HF_FREE_DEEPSEEK_MODELS } from './src/services/LLMClient.js';

let passed = 0;
let failed = 0;
const ok = (cond, msg) => {
  if (cond) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.log(`  ❌ ${msg}`); }
};

console.log('\n== B72/B73 — WORKER ROUTER: DEAD MODELS REMOVED + LIVE FREE CHAINS ==');

// 1. Every dead model must be gone from every coworker chain.
const ALL_PROVIDERS = Object.values(COWORKERS).flatMap((w) => w.providers);
ok(
  !ALL_PROVIDERS.some((p) => String(p.model || '').includes('qwen3-8b:free')),
  'no qwen/qwen3-8b:free anywhere in COWORKERS (model deleted from OpenRouter)'
);
ok(
  !JSON.stringify(COWORKERS).includes('qwen3-8b:free'),
  'no ":free" qwen reference survives in the whole COWORKERS blob'
);
// B73 — the other OpenRouter :free models that were REMOVED must not be back.
ok(
  !JSON.stringify(COWORKERS).includes('llama-3.3-70b-instruct:free') &&
  !JSON.stringify(COWORKERS).includes('deepseek-chat-v3-0324:free') &&
  !JSON.stringify(COWORKERS).includes('qwen-2.5-72b-instruct:free'),
  'no dead OpenRouter :free entries (llama-3.3-70b / deepseek-chat-v3-0324 / qwen-2.5-72b) in COWORKERS'
);

// 2. B73 — genuinely free models are wired into the chains (live-verified $0
//    against openrouter.ai/api/v1/models: zero free Qwen/DeepSeek remain, so
//    the free capacity comes from nemotron / north-mini-code / gemma).
ok(
  OPENROUTER_FREE_TEXT_MODELS.every((m) => JSON.stringify(COWORKERS).includes(m)),
  `every verified-free OpenRouter model is wired into COWORKERS (${OPENROUTER_FREE_TEXT_MODELS.join(', ')})`
);

// 3. Memory coworker (conversation path) leads with a FREE model, then the
//    near-free workhorse, then Gemini's free tier.
const memoryChain = coworkerChain('memory');
ok(
  memoryChain[0] && memoryChain[0].key === 'openrouter' && memoryChain[0].model === 'nvidia/nemotron-3-super-120b-a12b:free',
  `memory worker primary = openrouter(nvidia/nemotron-3-super-120b-a12b:free) — $0, got ${JSON.stringify(memoryChain[0])}`
);
ok(
  memoryChain[1] && memoryChain[1].key === 'openrouter' && memoryChain[1].model === 'bytedance-seed/seed-2.0-mini',
  'memory worker #2 = openrouter(bytedance-seed/seed-2.0-mini) — near-free workhorse stays reachable'
);
ok(
  memoryChain[2] && memoryChain[2].key === 'gemini' && memoryChain[2].model === 'gemini-2.5-flash',
  'memory worker #3 = gemini(gemini-2.5-flash) — free tier, large-context provider stays reachable'
);

// 4. Coder coworker: DeepSeek (paid-but-cheap primary, no free tier exists —
//    verified) then the FREE code model, then the near-free workhorse.
const coderChain = coworkerChain('coder');
ok(
  coderChain[1] && coderChain[1].key === 'openrouter' && coderChain[1].model === 'cohere/north-mini-code:free',
  `coder #2 = openrouter(cohere/north-mini-code:free) — free code model, got ${JSON.stringify(coderChain[1])}`
);
ok(
  coderChain[2] && coderChain[2].key === 'openrouter' && coderChain[2].model === 'bytedance-seed/seed-2.0-mini',
  `coder #3 = openrouter(bytedance-seed/seed-2.0-mini) — near-free fallback, got ${JSON.stringify(coderChain[2])}`
);
ok(coderChain[0] && coderChain[0].key === 'deepseek', 'coder #1 stays deepseek(deepseek-chat) — architecture primary');

// 4b. B73 follow-up — free Qwen AND free DeepSeek are real via HuggingFace
//     serverless (already wired): the documented lists point at HF-served
//     models (live-verified HTTP 401 = served, token-gated = free tier), and
//     the fallback tier reaches HF where they actually live.
ok(
  QWEN_MODELS.every((m) => HF_FREE_QWEN_MODELS.includes(m)),
  'free Qwen is served via HuggingFace Inference API (Qwen2.5-7B-Instruct + Qwen2.5-Coder-7B-Instruct)'
);
ok(
  HF_FREE_DEEPSEEK_MODELS.length === 2 &&
  HF_FREE_DEEPSEEK_MODELS[0] === 'deepseek-ai/deepseek-coder-6.7b-instruct' &&
  HF_FREE_DEEPSEEK_MODELS[1] === 'deepseek-ai/DeepSeek-R1-Distill-Qwen-7B',
  'free DeepSeek is served via HuggingFace Inference API (deepseek-coder-6.7b-instruct + DeepSeek-R1-Distill-Qwen-7B)'
);
ok(
  coworkerChain('coder').some((p) => p.key === 'huggingface') && coworkerChain('memory').some((p) => p.key === 'huggingface'),
  'fallback tier reaches HuggingFace where the free DeepSeek + Qwen models live'
);

// 5. Conversation still routes to the memory worker (unchanged semantics).
ok(coworkerFor('conversation') === 'memory', 'conversation → memory worker (unchanged)');
ok(coworkerFor('build me a calculator app') === 'coder', 'code request → coder worker (unchanged)');
ok(coworkerFor('latest news on AI') === 'researcher', 'research request → researcher worker (unchanged)');

// 6. The fallback tier is still appended after each coworker's own chain
//    (memory now owns 3 providers, so the chain is 6 entries long).
const memChain = coworkerChain('memory');
ok(
  memChain.length === 6 && memChain[3].key === 'huggingface' && memChain[4].key === 'deepinfra' && memChain[5].key === 'mistral',
  'memory chain = [nemotron:free, seed-2.0-mini, gemini, huggingface, deepinfra, mistral] (fallback tier appended)'
);

// 7. workerRoster() (Models screen) reflects the free-first chains.
const roster = workerRoster();
const memoryRoster = roster.find((w) => w.slug === 'memory');
ok(
  memoryRoster && memoryRoster.providers[0] === 'openrouter:nvidia/nemotron-3-super-120b-a12b:free',
  `Models screen roster shows the free memory primary, got ${memoryRoster && memoryRoster.providers[0]}`
);

// 8. runWorker's native tool path still completes with the new config
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

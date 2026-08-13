/**
 * JEXI OS — Model Routing (roadmap stage 24: model routing per agent/skill).
 *
 * The provider router fails over globally; this layer biases WHICH provider
 * leads for WHICH kind of task — per-domain model routing without touching
 * every call site. It maps planner intents to a provider preference that is
 * passed through generateContent(opts.prefer):
 *
 *   math/solve        → gemini (strong at structured reasoning)
 *   research/study    → openrouter (broad free model selection)
 *   code/news/data    → groq (fast, generous free tier)
 *   image/vision      → gemini (vision-capable)
 *
 * The map is data, not code: /api/models exposes it, the Models screen shows
 * it, and changing it takes effect without a redeploy.
 */

export const INTENT_PREFERENCE = {
  math_solve: 'gemini',
  image_recognition: 'gemini',
  vision: 'gemini',
  research: 'openrouter',
  learning_research: 'openrouter',
  study_topic: 'openrouter',
  link_analysis: 'openrouter',
  news_latest: 'openrouter',
  code_task: 'groq',
  github: 'groq',
  data: 'groq',
  devops: 'groq',
  docs: 'groq',
  compound_task: '',
  translate: '',
  conversation: '',
};

/** Provider preference for an intent ('' = default order). */
export function providerPreferenceForIntent(intent) {
  return INTENT_PREFERENCE[intent] || '';
}

const PROVIDER_LABELS = {
  groq: 'Groq', gemini: 'Gemini', openrouter: 'OpenRouter',
  cerebras: 'Cerebras', deepinfra: 'DeepInfra', mistral: 'Mistral', xai: 'Grok (xAI)', huggingface: 'HuggingFace',
};

/** Full routing table for the Models screen. */
export function modelRoutingTable() {
  return Object.entries(INTENT_PREFERENCE).map(([intent, prefer]) => ({
    intent,
    provider: prefer || '(auto)',
    providerLabel: prefer ? PROVIDER_LABELS[prefer] || prefer : 'Automatic failover',
  }));
}

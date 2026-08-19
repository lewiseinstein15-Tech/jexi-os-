/**
 * B143 — MODEL SELECTION (DeepSeek Harness `packages/client/ui-model-selection`
 * mirror, JEXI-branded).
 *
 * Client-side model provider picker: the provider table (capabilities +
 * tool support), resolution by intent, and the preference order mirror of
 * the server ModelRouting.
 */

export const MODEL_PROVIDERS = {
  groq: { name: 'Groq', tools: true, vision: false, tier: 'fast' },
  openrouter: { name: 'OpenRouter', tools: true, vision: true, tier: 'smart' },
  deepseek: { name: 'DeepSeek', tools: true, vision: false, tier: 'smart' },
  xai: { name: 'xAI', tools: true, vision: true, tier: 'smart' },
  gemini: { name: 'Gemini', tools: true, vision: true, tier: 'smart' },
  mistral: { name: 'Mistral', tools: true, vision: false, tier: 'fast' },
  cerebras: { name: 'Cerebras', tools: false, vision: false, tier: 'fast' },
  sambanova: { name: 'SambaNova', tools: false, vision: false, tier: 'fast' },
};

/** Intent → provider preference (mirror of server providerPreferenceForIntent). */
export function resolveProviderForIntent(intent, { available = null } = {}) {
  const avail = available || Object.keys(MODEL_PROVIDERS);
  const order = intent === 'conversation' || intent === 'direct_answer'
    ? ['groq', 'cerebras', 'sambanova', 'mistral', 'openrouter', 'deepseek', 'xai', 'gemini']
    : intent === 'vision' || intent === 'image'
      ? ['gemini', 'openrouter', 'xai', 'groq']
      : ['groq', 'openrouter', 'deepseek', 'xai', 'gemini', 'mistral', 'cerebras', 'sambanova'];
  return order.find((p) => avail.includes(p)) || null;
}

/** Provider table for the settings UI. */
export function modelSelectionStatus({ available = null } = {}) {
  const avail = available || Object.keys(MODEL_PROVIDERS);
  return {
    ok: true,
    providers: Object.entries(MODEL_PROVIDERS)
      .filter(([key]) => avail.includes(key))
      .map(([key, spec]) => ({ key, ...spec, available: true })),
  };
}

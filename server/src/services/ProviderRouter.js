/**
 * JEXI OS — Provider Router.
 *
 * OmniRoute-style multi-provider routing for the free AI keys JEXI already
 * accepts (Groq, Gemini, OpenRouter, HuggingFace). The idea from the research:
 * a gateway that NEVER dies with one provider — if a key rate-limits, times
 * out, or errors, the router slides to the next healthy provider automatically
 * and remembers which ones have been failing (cooldowns) so it stops wasting
 * time on a provider that is down.
 *
 * This module is pure routing state + ordering. The actual HTTP/SDK calls live
 * in LLMClient (tryGroq/tryGemini/tryOpenRouter/…) — the router decides the
 * ORDER and tracks HEALTH so generateContent just walks the list.
 */

const COOLDOWN_MS = 30_000;        // skip a provider for 30s after a failure
const CONSECUTIVE_COOLDOWN = 3;    // 3 consecutive failures → cooldown

/** Provider health state (in-memory — resets on restart, which is fine). */
const health = new Map();

function h(key) {
  if (!health.has(key)) health.set(key, { fails: 0, lastFail: 0, cooldownUntil: 0, calls: 0, ok: 0 });
  return health.get(key);
}

/** Record a success — resets the failure streak and clears any cooldown. */
export function recordProviderSuccess(key) {
  const s = h(key);
  s.calls++;
  s.ok++;
  s.fails = 0;
  s.lastFail = 0;
  s.cooldownUntil = 0;
}

/** Record a failure — starts/extends a cooldown after CONSECUTIVE_COOLDOWN. */
export function recordProviderFailure(key) {
  const s = h(key);
  s.calls++;
  s.fails++;
  s.lastFail = Date.now();
  if (s.fails >= CONSECUTIVE_COOLDOWN) {
    s.cooldownUntil = Date.now() + COOLDOWN_MS;
  }
}

/** Is this provider currently in cooldown? */
export function providerInCooldown(key) {
  return h(key).cooldownUntil > Date.now();
}

/** Reset health for a provider (used by tests and manual recovery). */
export function resetProviderHealth(key) {
  if (health.has(key)) health.delete(key);
}

/**
 * Force a LONG cooldown (default 1h) — used when a provider is unusable, e.g.
 * HTTP 402 payment-required (Cerebras/DeepInfra without billing). A dead
 * provider shouldn't slow down every request with a retry loop, so it gets
 * parked for an hour instead of the usual 30s.
 */
export function markProviderUnavailable(key, minutes = 60) {
  const s = h(key);
  s.fails = Math.max(s.fails, 3);
  s.lastFail = Date.now();
  s.cooldownUntil = Date.now() + minutes * 60 * 1000;
}

/**
 * Ordered provider keys for a request, adjusted by health.
 * `prefer` biases the order for the task type:
 *   'gemini'     → Gemini first (strong at code), then Groq, then OpenRouter, then HF
 *   'openrouter' → OpenRouter free models first (Seed/DeepSeek/Qwen family)
 *   default      → Groq first (fast + free), then Gemini, OpenRouter, HF
 * Cooldowned providers are pushed to the END, healthy ones keep priority.
 */
// Extra free OpenAI-compatible providers — slots in after the big three,
// before HuggingFace (slow last-resort). Each is optional; a missing key is
// simply skipped by the router. Adding one only means setting ONE env var.
// B66 — DeepSeek joins the free/optional OpenAI-compatible tier (the primary
// coding coworker). Qwen is reached via OpenRouter models (no separate key).
// B74 — vLLM (self-hosted): genuinely free inference on the user's own
// hardware via an OpenAI-compatible server (github.com/vllm-project/vllm).
// Sits right before the slow HF free tier; skipped instantly when nothing is
// listening on VLLM_BASE_URL (default http://localhost:8000/v1).
// B75 — NVIDIA NIM + SambaNova join the no-card free tier (research: GitHub
// Models was retired 2026-07-30; these two are live-verified free with no
// credit card — NVIDIA gives free DeepSeek V4 Flash, SambaNova free
// DeepSeek-V3.1/V3.2).
const EXTRA_PROVIDERS = ['cerebras', 'deepinfra', 'mistral', 'xai', 'deepseek', 'nvidia', 'sambanova'];

export function providerOrder(prefer = '') {
  const base =
    prefer === 'gemini'
      ? ['gemini', 'groq', 'openrouter', ...EXTRA_PROVIDERS, 'vllm', 'huggingface']
      : prefer === 'openrouter'
        ? ['openrouter', 'groq', 'gemini', ...EXTRA_PROVIDERS, 'vllm', 'huggingface']
        : ['groq', 'gemini', 'openrouter', ...EXTRA_PROVIDERS, 'vllm', 'huggingface'];

  const healthy = base.filter((k) => !providerInCooldown(k));
  const cooling = base.filter((k) => providerInCooldown(k));
  return [...healthy, ...cooling];
}

/** Which providers have keys configured right now (no secrets exposed). */
const ENV_MAP = {
  groq: 'GROQ_API_KEY',
  gemini: 'GEMINI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  huggingface: 'HF_TOKEN',
  cerebras: 'CEREBRAS_API_KEY',
  deepinfra: 'DEEPINFRA_API_KEY',
  mistral: 'MISTRAL_API_KEY',
  xai: 'XAI_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  nvidia: 'NVIDIA_API_KEY',
  sambanova: 'SAMBANOVA_API_KEY',
  // B74 — vLLM has no API key; "configured" = a VLLM_BASE_URL is set.
  vllm: 'VLLM_BASE_URL',
};

/** Which providers have keys configured right now (no secrets exposed). */
export function configuredProviders() {
  return Object.keys(ENV_MAP).filter((k) => !!process.env[ENV_MAP[k]]);
}

/** Snapshot for /api/health and the self-check (never leaks key material). */
export function providerHealthSnapshot() {
  const now = Date.now();
  const names = {
    groq: 'Groq', gemini: 'Gemini', openrouter: 'OpenRouter', huggingface: 'HuggingFace',
    cerebras: 'Cerebras', deepinfra: 'DeepInfra', mistral: 'Mistral', xai: 'Grok (xAI)', deepseek: 'DeepSeek',
    nvidia: 'NVIDIA NIM', sambanova: 'SambaNova',
    vllm: 'vLLM (self-hosted)',
  };
  return providerOrder().map((k) => {
    const s = h(k);
    return {
      provider: names[k] || k,
      key: k,
      order: providerOrder().indexOf(k) + 1,
      configured: !!process.env[ENV_MAP[k]],
      calls: s.calls,
      ok: s.ok,
      fails: s.fails,
      inCooldown: providerInCooldown(k),
      cooldownLeftSec: Math.max(0, Math.round((s.cooldownUntil - now) / 1000)),
    };
  });
}

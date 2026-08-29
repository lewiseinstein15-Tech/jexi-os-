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
 *
 * B77 — FREE-ONLY routing: every payment-gated provider was REMOVED from the
 * active order (Cerebras, DeepInfra, xAI/Grok, direct DeepSeek, SambaNova —
 * all live-probed 402/403). They can never be attempted again until someone
 * explicitly re-adds them; the walk is now only the six live-verified free
 * tiers + self-hosted vLLM.
 */

const COOLDOWN_MS = 30_000;        // skip a provider for 30s after a failure
const CONSECUTIVE_COOLDOWN = 3;    // 3 consecutive failures → cooldown

/** Provider health state (in-memory — resets on restart, which is fine). */
const health = new Map();

function h(key) {
  if (!health.has(key)) health.set(key, { fails: 0, lastFail: 0, cooldownUntil: 0, calls: 0, ok: 0, latencyEma: null, lastLatency: null });
  return health.get(key);
}

/**
 * Record a success — resets the failure streak, clears any cooldown, and
 * folds the call's latency into an EMA (B172, dsh delegate-router style:
 * light work goes to the FASTEST healthy provider, measured — not guessed).
 */
export function recordProviderSuccess(key, latencyMs = null) {
  const s = h(key);
  s.calls++;
  s.ok++;
  s.fails = 0;
  s.lastFail = 0;
  s.cooldownUntil = 0;
  if (Number.isFinite(latencyMs) && latencyMs > 0) {
    s.lastLatency = Math.round(latencyMs);
    s.latencyEma = s.latencyEma == null ? Math.round(latencyMs) : Math.round(s.latencyEma * 0.6 + latencyMs * 0.4);
  }
}

/** Measured EMA latency for a provider (null = never measured). */
export function providerLatency(key) {
  const s = health.get(key);
  return s ? s.latencyEma : null;
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
 * HTTP 402 payment-required. A dead provider shouldn't slow down every request
 * with a retry loop, so it gets parked for an hour instead of the usual 30s.
 */
export function markProviderUnavailable(key, minutes = 60) {
  const s = h(key);
  s.fails = Math.max(s.fails, 3);
  s.lastFail = Date.now();
  s.cooldownUntil = Date.now() + minutes * 60 * 1000;
}

/**
 * B77 — FREE-ONLY extras. The payment-gated providers (cerebras, deepinfra,
 * xai, deepseek, sambanova — all live-probed 402/403) were REMOVED from this
 * list so the router can never attempt them. Only the live-verified free
 * tiers remain: Mistral (Experiment free tier) and NVIDIA NIM (no-card free
 * key, DeepSeek V4 Flash). The provider code still exists in LLMClient for
 * anyone who later funds an account — re-adding here is a one-line change.
 */
const EXTRA_PROVIDERS = ['mistral', 'nvidia'];

/* B172 — SPEED-AWARE ROUTING (replaces B77's random rotation). DSH's
 * delegate-router principle: route by MEASURED latency, deterministically.
 * Random rotation made every request a lottery — a greeting sometimes landed
 * on a slow provider (13.5s) and sometimes a fast one (7s). Now the healthy
 * head is sorted by its measured EMA latency (unmeasured providers keep
 * their base position between the measured ones, so a fresh provider is
 * still tried and gets measured). Rate limits stay protected the honest
 * way: when the fastest provider 429s it enters cooldown and the next
 * fastest serves while it rests. */
function speedSortedHead(head) {
  const measured = head.filter((k) => providerLatency(k) != null);
  if (measured.length < 2) return head; // not enough data — keep base order
  const bySpeed = [...measured].sort((a, b) => providerLatency(a) - providerLatency(b));
  // stable merge: unmeasured providers keep relative base order after the
  // measured ones they interrupted, so nothing is starved before it's tried
  const out = [];
  let mi = 0;
  for (const k of head) {
    if (providerLatency(k) != null) { out.push(bySpeed[mi++]); } else { out.push(k); }
  }
  return out;
}

/**
 * Ordered provider keys for a request, adjusted by health.
 * `prefer` biases the order for the task type:
 *   'gemini'     → Gemini first (strong at code), then Groq, then OpenRouter, then HF
 *   'openrouter' → OpenRouter free models first (Seed vision family)
 *   default      → rotated across Groq / Gemini / OpenRouter (load spread), then extras
 * Cooldowned providers are pushed to the END, healthy ones keep priority.
 */
export function providerOrder(prefer = '') {
  const base =
    prefer === 'gemini'
      ? ['gemini', 'groq', 'openrouter', ...EXTRA_PROVIDERS, 'vllm', 'huggingface']
      : prefer === 'openrouter'
        ? ['openrouter', 'groq', 'gemini', ...EXTRA_PROVIDERS, 'vllm', 'huggingface']
        : ['groq', 'gemini', 'openrouter', ...EXTRA_PROVIDERS, 'vllm', 'huggingface'];

  const healthy = base.filter((k) => !providerInCooldown(k));
  const cooling = base.filter((k) => providerInCooldown(k));

  if (!prefer) {
    // B172 — deterministic: the healthy head is sorted by MEASURED latency
    // (fastest first). The slow tail (vLLM → HuggingFace) never reorders.
    const head = speedSortedHead(healthy.slice(0, 3));
    const tail = healthy.slice(3);
    return [...head, ...tail, ...cooling];
  }
  return [...healthy, ...cooling];
}

/** Which providers have keys configured right now (no secrets exposed). */
// B77 — payment-gated providers removed from ENV_MAP too: they are never
// probed by the health checks and never counted as configured.
const ENV_MAP = {
  groq: 'GROQ_API_KEY',
  gemini: 'GEMINI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  huggingface: 'HF_TOKEN',
  mistral: 'MISTRAL_API_KEY',
  nvidia: 'NVIDIA_API_KEY',
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
    mistral: 'Mistral', nvidia: 'NVIDIA NIM',
    vllm: 'vLLM (self-hosted)',
  };
  // B77 — compute the order ONCE (it rotates, so a second call could change
  // the positions and make indexOf return -1 for every key).
  const order = providerOrder();
  return order.map((k) => {
    const s = h(k);
    return {
      provider: names[k] || k,
      key: k,
      order: order.indexOf(k) + 1,
      configured: !!process.env[ENV_MAP[k]],
      calls: s.calls,
      ok: s.ok,
      fails: s.fails,
      inCooldown: providerInCooldown(k),
      cooldownLeftSec: Math.max(0, Math.round((s.cooldownUntil - now) / 1000)),
    };
  });
}

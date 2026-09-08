/**
 * JEXI OS — Model capability profiles.
 *
 * Context assembly, tool routing and verification budgets need to know what
 * the CURRENT model can do. This module answers from a curated table of
 * well-known models (matched by regex, most-specific first) with honest
 * defaults for unknown ids — and remembers live probe results per process.
 *
 * capabilitiesFor(modelId) → {
 *   contextWindow, maxOutput, vision, tools, reasoning, streaming,
 *   source: 'known' | 'probed' | 'default'
 * }
 */

const KNOWN = [
  // OpenAI
  { re: /gpt-4o-mini|gpt-4\.1-mini|o4-mini/i, contextWindow: 128_000, maxOutput: 16_384, vision: true, tools: true, reasoning: false },
  { re: /gpt-4o\b|gpt-4\.1\b/i, contextWindow: 128_000, maxOutput: 16_384, vision: true, tools: true, reasoning: false },
  { re: /\bo[13](-mini)?\b/i, contextWindow: 200_000, maxOutput: 100_000, vision: true, tools: true, reasoning: true },
  // Anthropic
  { re: /claude-opus-4/i, contextWindow: 200_000, maxOutput: 32_000, vision: true, tools: true, reasoning: true },
  { re: /claude-sonnet-4/i, contextWindow: 200_000, maxOutput: 32_000, vision: true, tools: true, reasoning: true },
  { re: /claude-haiku/i, contextWindow: 200_000, maxOutput: 8_192, vision: true, tools: true, reasoning: false },
  { re: /claude-3/i, contextWindow: 200_000, maxOutput: 8_192, vision: true, tools: true, reasoning: false },
  // Google
  { re: /gemini-2\.5-pro|gemini-3/i, contextWindow: 1_000_000, maxOutput: 65_536, vision: true, tools: true, reasoning: true },
  { re: /gemini/i, contextWindow: 1_000_000, maxOutput: 32_768, vision: true, tools: true, reasoning: false },
  // DeepSeek
  { re: /deepseek-reasoner|r1/i, contextWindow: 128_000, maxOutput: 32_768, vision: false, tools: false, reasoning: true },
  { re: /deepseek/i, contextWindow: 128_000, maxOutput: 8_192, vision: false, tools: true, reasoning: false },
  // Open weights, commonly served
  { re: /gpt-oss-120b/i, contextWindow: 128_000, maxOutput: 16_384, vision: false, tools: true, reasoning: true },
  { re: /gpt-oss-20b/i, contextWindow: 128_000, maxOutput: 16_384, vision: false, tools: true, reasoning: true },
  { re: /qwen3?-?235b|qwen.*max/i, contextWindow: 128_000, maxOutput: 16_384, vision: false, tools: true, reasoning: true },
  { re: /qwen/i, contextWindow: 128_000, maxOutput: 8_192, vision: false, tools: true, reasoning: false },
  { re: /llama-3\.3-70b|llama.*70b/i, contextWindow: 128_000, maxOutput: 8_192, vision: false, tools: true, reasoning: false },
  { re: /llama-3\.1-8b|llama.*8b/i, contextWindow: 128_000, maxOutput: 8_192, vision: false, tools: true, reasoning: false },
  { re: /nemotron/i, contextWindow: 262_000, maxOutput: 16_384, vision: false, tools: true, reasoning: true },
  { re: /gemma/i, contextWindow: 128_000, maxOutput: 8_192, vision: false, tools: true, reasoning: false },
  { re: /mistral-(large|medium)/i, contextWindow: 128_000, maxOutput: 8_192, vision: true, tools: true, reasoning: false },
  { re: /mistral-small|mixtral/i, contextWindow: 32_000, maxOutput: 8_192, vision: false, tools: true, reasoning: false },
  { re: /grok-4/i, contextWindow: 256_000, maxOutput: 16_384, vision: true, tools: true, reasoning: true },
  { re: /grok/i, contextWindow: 128_000, maxOutput: 8_192, vision: true, tools: true, reasoning: false },
  { re: /seed/i, contextWindow: 128_000, maxOutput: 8_192, vision: true, tools: true, reasoning: false },
];

/** Conservative defaults for unknown model ids (honest, not optimistic). */
export const DEFAULT_CAPABILITIES = {
  contextWindow: 32_000,
  maxOutput: 8_192,
  vision: false,
  tools: true, // attempted, with automatic tools→plain fallback in the adapters
  reasoning: false,
  streaming: true,
};

/** Live probe cache: modelId → partial capabilities (process-local). */
const probeCache = new Map();

/** Record a live observation (e.g. tools rejected, vision worked). */
export function noteProbe(modelId, patch = {}) {
  if (!modelId) return;
  const prev = probeCache.get(String(modelId)) || {};
  probeCache.set(String(modelId), { ...prev, ...patch });
}

/** Clear probe state (tests). */
export function clearProbes() {
  probeCache.clear();
}

export function capabilitiesFor(modelId) {
  const id = String(modelId || '');
  const known = KNOWN.find((k) => k.re.test(id));
  const base = known
    ? { contextWindow: known.contextWindow, maxOutput: known.maxOutput, vision: known.vision, tools: known.tools, reasoning: known.reasoning, streaming: true, source: 'known' }
    : { ...DEFAULT_CAPABILITIES, source: 'default' };
  const probed = probeCache.get(id);
  if (probed && Object.keys(probed).length) {
    return { ...base, ...probed, source: base.source === 'known' ? 'known' : 'probed' };
  }
  return base;
}

/**
 * Token budget helper for the Context Engine: usable input tokens for the
 * current model after reserving output headroom.
 */
export function inputTokenBudget(modelId, { reserveOutput = true } = {}) {
  const caps = capabilitiesFor(modelId);
  const reserve = reserveOutput ? Math.min(caps.maxOutput, Math.floor(caps.contextWindow / 4)) : 0;
  return Math.max(4000, caps.contextWindow - reserve);
}

/** Rough chars→tokens estimate (≈4 chars/token for English/code mix). */
export function estimateTokens(text) {
  return Math.ceil(String(text || '').length / 4);
}

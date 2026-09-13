/**
 * JEXI OS — Provider bridge — public API.
 *
 *   getProvider(id)
 *   chat(request, { providerId, chain, fallback })
 *   stream(request, { providerId })
 *   countTokens(text)
 *   estimateCost(request, { providerId })
 *   listProviders() / listModels(providerId)
 *   resolveCapability(profile) → { providerId, model }
 *   classifyError(raw)
 *   ListModels / NormalizedResponse / NormalizedToolCall / ClassifiedError
 *
 * Business logic imports ONLY this module.
 */

import { registry, getProvider, listProviders, listModels, _reset } from './registry.js';
import { resolveCapability, modelSatisfies, priceOf } from './router/CapabilityRouter.js';
import { taskClassChain, TASK_CLASSES, classifyProfile } from './router/TaskClassChain.js';
import { tryChain } from './router/FallbackChain.js';
import { cheapestSatisfying, rankByPrice } from './router/CostOptimizer.js';
import { normalizeResponse, normalizeToolCall, normalizeError } from './transform/normalize.js';
import { ClassifiedError, classifyError } from './error/classify.js';
import { shouldRetry, isHardFailure } from './error/retryability.js';
import { NormalizedResponse } from './interface/NormalizedResponse.js';
import { NormalizedToolCall } from './interface/NormalizedToolCall.js';
import { isLLMProvider } from './interface/LLMProvider.js';

export {
  getProvider, listProviders, listModels, registry, _reset,
  resolveCapability, modelSatisfies, priceOf,
  taskClassChain, TASK_CLASSES, classifyProfile,
  tryChain, cheapestSatisfying, rankByPrice,
  normalizeResponse, normalizeToolCall, normalizeError,
  ClassifiedError, classifyError, shouldRetry, isHardFailure,
  NormalizedResponse, NormalizedToolCall, isLLMProvider,
};

/**
 * Resolve a provider that can transcribe audio (capability-driven).
 * Returns { providerId, transcribe } or null when none is configured.
 * Business logic never names a provider — it asks for the capability.
 */
export function resolveAudioTranscriber(env = process.env) {
  const providers = registry(env);
  for (const p of providers) {
    if (p.cfg?.needsKey === false) continue; // keyless lanes don't transcribe
    if (p.isConfigured && !p.isConfigured()) continue;
    const audio = p.capabilities?.audio;
    if (!audio?.transcription) continue;
    if (typeof p.transcribeAudio !== 'function') continue;
    return { providerId: p.id, transcribe: (task) => p.transcribeAudio(task) };
  }
  return null;
}

/**
 * True when at least one KEYED provider is configured with a key AND has a
 * model satisfying the given capabilities.
 *
 * Keyed-only by design: it is the capability mirror of the legacy
 * `resolveKeys()` presence checks that business logic used to gate on
 * ("should I call the model?"). Keyless lanes (a local engine without a key)
 * are deliberately excluded so deterministic fallbacks still engage when no
 * cloud key exists — exactly what the old gates did.
 *
 * Capability flags (optional): 'vision', 'tool_calling', 'code_reasoning'.
 */
export function canChat(capabilities = []) {
  const providers = registry();
  for (const p of providers) {
    const needsKey = p.cfg?.needsKey !== false;
    if (!needsKey) continue; // keyless lanes (ollama) do not satisfy key-presence gates
    if (!p.isConfigured || !p.isConfigured()) continue;
    const models = p.listModels ? p.listModels() : [];
    if (!models.length) continue;
    if (!capabilities.length) return true;
    const ok = capabilities.every((cap) => {
      if (cap === 'vision') return models.some((m) => m.capabilities?.vision === true);
      if (cap === 'tool_calling') return models.some((m) => m.capabilities?.toolCalling === true);
      if (cap === 'code_reasoning') return models.some((m) => (m.capabilities?.codeReasoning ?? 'weak') !== 'weak');
      return true;
    });
    if (ok) return true;
  }
  return false;
}

/** Convenience: can the current setup do the most demanding common lanes? */
export function canVision() {
  return canChat(['vision']);
}

/** Single-entry chat with optional automatic capability resolution + fallback. */
export async function chat(request, opts = {}) {
  if (opts.providerId) {
    const provider = getProvider(opts.providerId);
    if (!provider) throw ClassifiedError.notConfigured(`provider not registered: ${opts.providerId}`, { provider: opts.providerId });
    return provider.chat(request);
  }
  if (opts.chain && opts.chain.length) {
    return tryChain(request, opts.chain, { onFallback: opts.onFallback });
  }
  if (opts.profile) {
    const resolution = resolveCapability(opts.profile, listProviders().map((p) => ({ providerId: p.id, provider: getProvider(p.id) })));
    if (!resolution) throw ClassifiedError.unsupportedCapability('no provider satisfies the capability profile', { provider: 'chain' });
    const provider = getProvider(resolution.providerId);
    return provider.chat({ ...request, model: resolution.model });
  }
  throw ClassifiedError.invalidRequest('chat() requires providerId, chain, or profile', { provider: 'api' });
}

/** Stream from a specific provider (or first configured). */
export async function* stream(request, opts = {}) {
  const provider = opts.providerId ? getProvider(opts.providerId) : listProviders()[0]?.id && getProvider(listProviders()[0].id);
  if (!provider) throw ClassifiedError.notConfigured('no provider available for stream()', { provider: 'api' });
  yield* provider.stream(request);
}

export function countTokens(text, providerId = null) {
  if (providerId) {
    const p = getProvider(providerId);
    if (p) return p.countTokens(text);
  }
  return Math.ceil(String(text ?? '').length / 4);
}

/**
 * Resolve the LOCAL (keyless, on-machine) provider — the adapter that speaks
 * the local backend protocol (a.k.a. the Ollama-shaped endpoint). Business
 * logic must never name a provider; it asks "is there a local backend?" and
 * uses whatever adapter answers. Returns null when none is registered.
 */
export function resolveLocalProvider(env = process.env) {
  const adapters = registry(env) || [];
  return adapters.find((p) => p.cfg?.needsKey === false || p.kind === 'local') ?? null;
}

/** True when the operator has configured a local backend as their preference. */
export function localProviderPreferred(env = process.env) {
  const local = resolveLocalProvider(env);
  if (!local) return false;
  try {
    const cfg = typeof local.config === 'function' ? local.config() : null;
    if (cfg && typeof cfg.preferred === 'boolean') return cfg.preferred;
  } catch { /* fall through to false */ }
  if (typeof local.isPreferred === 'function') {
    try { return !!local.isPreferred(); } catch { /* false */ }
  }
  return false;
}

/**
 * Capability check: is an OFFLINE (local) reasoning backend available for
 * the given capability lane? The name of the concrete provider never appears
 * here — callers ask "can I reason locally?" and get a boolean.
 */
export function hasLocalCapability(capability = 'reasoning', env = process.env) {
  const local = resolveLocalProvider(env);
  if (!local) return false;
  try {
    if (!local.isConfigured || !local.isConfigured()) return false;
  } catch { return false; }
  const caps = local.capabilities || {};
  if (capability === 'reasoning') return true; // a local LLM can reason by default
  if (capability === 'audio_transcription') return !!caps.audio?.transcription;
  if (capability === 'vision') return !!caps.vision;
  if (capability === 'tool_calling') return !!caps.toolCalling;
  return true;
}

/**
 * Keyed (paid-key) search providers, built in the providers layer. The seam
 * deps ({ keyFor, httpCall, WebError, isGarbageUrl, … }) are injected by the
 * caller (WebSearch.js) so this module never imports a services/ dependency.
 * Business logic resolves BY CONFIG KEY, never by provider name.
 */
export async function getKeyedSearchProviders(deps) {
  const { createKeyedSearchProviders } = await import('./search/index.js');
  return createKeyedSearchProviders(deps);
}

/** Resolve a keyed search provider by its config env key (e.g. 'EXA_API_KEY'). */
export async function getSearchProviderByEnvKey(envKey, deps) {
  const { searchProviderByEnvKey } = await import('./search/index.js');
  return searchProviderByEnvKey(envKey, deps);
}

export async function estimateCost(request, opts = {}) {
  const provider = opts.providerId ? getProvider(opts.providerId) : listProviders()[0];
  return provider ? provider.estimateCost(request) : 0;
}
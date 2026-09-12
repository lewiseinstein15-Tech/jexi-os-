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

export async function estimateCost(request, opts = {}) {
  const provider = opts.providerId ? getProvider(opts.providerId) : listProviders()[0];
  return provider ? provider.estimateCost(request) : 0;
}
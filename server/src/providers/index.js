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
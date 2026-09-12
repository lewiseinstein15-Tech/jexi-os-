/**
 * JEXI OS — Provider bridge — capability router.
 *
 * Resolves a CapabilityProfile → (provider, model) by walking the task-class
 * chain and picking the first provider+model that satisfies the profile's
 * hard requirements. First-success-wins; falls through only on
 * not-configured / no-usable-model (the runtime failure fallback lives in
 * FallbackChain.js).
 */

import { classifyProfile, taskClassChain } from './TaskClassChain.js';

/** Math uniforms for price comparison. */
export function priceOf(modelMeta) {
  if (!modelMeta) return Infinity;
  return (modelMeta.priceInPer1M ?? 0) + (modelMeta.priceOutPer1M ?? 0);
}

/** True when a model meta satisfies all hard requirement flags in a profile. */
export function modelSatisfies(meta, profile) {
  if (!meta) return false;
  const requires = profile.requires ?? [];
  if (requires.includes('tool_calling') && meta.toolCalling === false) return false;
  if (requires.includes('vision') && meta.vision === false) return false;
  if (requires.includes('long_context')
    && profile.minContextTokens
    && (meta.contextWindow ?? 0) < profile.minContextTokens) return false;
  if (requires.includes('code_reasoning') && profile.minCodeReasoning) {
    const ranks = { weak: 1, medium: 2, strong: 3 };
    if ((ranks[meta.codeReasoning] ?? 0) < (ranks[profile.minCodeReasoning] ?? 0)) return false;
  }
  return true;
}

/**
 * @param {CapabilityProfile} profile
 * @param {{providerId: string, provider: object}[]} available
 * @param {object} [opts]  { taskClass, chain }
 * @returns {{providerId, model, reason} | null}
 */
export function resolveCapability(profile, available, opts = {}) {
  const taskClass = opts.taskClass ?? classifyProfile(profile);
  const chain = opts.chain?.length ? opts.chain : taskClassChain(taskClass);
  for (const providerId of chain) {
    const entry = available.find((a) => a.providerId === providerId);
    if (!entry) continue; // provider not registered
    if (entry.provider.isConfigured && !entry.provider.isConfigured()) continue;
    const models = entry.provider.listModels ? entry.provider.listModels() : [];
    const candidates = models.filter((m) => modelSatisfies(m, profile));
    if (!candidates.length) continue;
    const picked = pickModel(candidates, profile);
    if (picked) {
      return {
        providerId,
        model: picked.id,
        reason: `${taskClass}@${providerId} via ${picked.id}`,
      };
    }
  }
  return null;
}

function pickModel(candidates, profile) {
  if (profile.preferredTier === 'small') {
    const cheapest = [...candidates].sort((a, b) => priceOf(a) - priceOf(b))[0];
    return cheapest ?? candidates[0];
  }
  if (profile.preferredTier === 'large') {
    return [...candidates].sort((a, b) => (b.contextWindow ?? 0) - (a.contextWindow ?? 0))[0];
  }
  return candidates[0];
}
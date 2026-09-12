/**
 * JEXI OS — Provider bridge — task-class chains.
 *
 * From the LLM-Agents-Ecosystem-Handbook: task classes (default, cheap,
 * fast, reasoning, long_context, vision, local) map to ordered provider
 * chains. The router tries the chain first-success-wins; it is NOT a load
 * balancer and NOT a circuit breaker.
 */

import { loadProviderConfig } from '../config/loader.js';

const FALLBACK_CHAINS = {
  default: ['openai', 'anthropic', 'openrouter'],
  cheap: ['groq', 'deepseek', 'openrouter'],
  fast: ['groq', 'openai', 'openrouter'],
  reasoning: ['anthropic', 'openai', 'google', 'deepseek'],
  long_context: ['google', 'anthropic', 'openai'],
  vision: ['openai', 'google', 'anthropic'],
  local: ['ollama'],
};

export function taskClassChain(taskClass) {
  const cfg = loadProviderConfig();
  const fromConfig = cfg.taskClasses?.[taskClass];
  if (Array.isArray(fromConfig) && fromConfig.length) return fromConfig;
  return FALLBACK_CHAINS[taskClass] ?? FALLBACK_CHAINS.default;
}

export const TASK_CLASSES = Object.keys(FALLBACK_CHAINS);

/** Map a CapabilityProfile to the best task class. */
export function classifyProfile(profile) {
  const requires = profile.requires ?? [];
  if (requires.includes('vision')) return 'vision';
  if (requires.includes('long_context')) return 'long_context';
  if (requires.includes('cheap')) return 'cheap';
  if (requires.includes('fast')) return 'fast';
  if (requires.includes('code_reasoning')) return 'reasoning';
  return 'default';
}
/**
 * JEXI OS — Phase 6 Scope C: CONTEXT MANAGER.
 *
 * Never send everything. The manager builds a model request from named
 * sources, allocates a token budget across them by priority, packs the result
 * into messages, and reports exactly what was kept, clipped, and dropped — so
 * context pressure is visible instead of silent.
 *
 *   sources/    registered async producers (mission, memory, history, tools,
 *               instruction) — fail-soft
 *   budget/     priority allocator clipping + dropping to a cap (chars + tokens)
 *   packing/    message assembly, plus greedy "how many items fit" packing
 *   compaction/ deterministic extractive range compaction + pressure meter
 *
 * build() is pure assembly. It performs no model calls.
 */

import { collectSources, listSources, registerSource, unregisterSource, getSource } from './sources/index.js';
import { clipToBudget, allocateBudget } from './budget/allocator.js';
import { packMessages } from './packing/prompt.js';
import { packItems } from './packing/exhaustive.js';
import { compact, compactRange, registerCompactor, contextPressure } from './compaction/summarize.js';

const DEFAULT_BUDGETS = {
  maxChars: 24000,
  maxTokens: 8000,
  perSectionChars: 6000,
};

/**
 * Build a budgeted model request.
 * @param {object} input  { mission, memories, history, tools, instruction, ... }
 * @param {{ budget?: object, system?: string, only?: string[] }} opts
 */
export async function build(input = {}, opts = {}) {
  const budget = { ...DEFAULT_BUDGETS, ...(opts.budget || {}) };
  const collected = await collectSources(input, {}, { only: opts.only || null });

  const sections = collected.map((c) => ({
    name: c.name,
    content: c.content,
    priority: c.spec.priority,
    weight: c.spec.weight,
    keep: c.spec.keep,
  }));

  const budgeted = clipToBudget(sections, budget);
  const packed = packMessages(budgeted.sections, {
    system: opts.system || input.system,
    instruction: input.instruction || '',
    maxTokens: budget.maxTokens,
  });

  const pressure = contextPressure(packed.usage.tokens, budget.maxTokens);
  const skipped = collected.filter((c) => c.skipped).map((c) => ({ name: c.name, reason: c.skipped }));

  return {
    messages: packed.messages,
    usage: { ...packed.usage, budget: { maxChars: budget.maxChars, maxTokens: budget.maxTokens } },
    sections: budgeted.sections.map((s) => s.name),
    clipped: [...new Set([...budgeted.clipped, ...packed.trimmed])],
    dropped: budgeted.dropped,
    skipped,
    pressure,
    allocations: allocateBudget(sections, budget.maxTokens),
  };
}

/** Synchronous convenience for callers that already have section content. */
export function buildFromSections(sections = [], opts = {}) {
  const budget = { ...DEFAULT_BUDGETS, ...(opts.budget || {}) };
  const budgeted = clipToBudget(sections, budget);
  const packed = packMessages(budgeted.sections, { system: opts.system, instruction: opts.instruction, maxTokens: budget.maxTokens });
  return {
    messages: packed.messages,
    usage: { ...packed.usage, budget: { maxChars: budget.maxChars, maxTokens: budget.maxTokens } },
    sections: budgeted.sections.map((s) => s.name),
    clipped: budgeted.clipped,
    dropped: budgeted.dropped,
    pressure: contextPressure(packed.usage.tokens, budget.maxTokens),
  };
}

export const ContextManager = {
  build,
  buildFromSections,
  packItems,
  compact,
  compactRange,
  contextPressure,
  registerSource,
  unregisterSource,
  listSources,
  getSource,
  registerCompactor,
  DEFAULT_BUDGETS,
};

export { collectSources, clipToBudget, allocateBudget, packMessages, packItems, compact, compactRange, contextPressure, registerSource, unregisterSource, listSources, getSource, registerCompactor };
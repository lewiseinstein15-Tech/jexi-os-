// prompt/tools/budget.js
// Token-budget enforcement for the tool description block (Phase 25, Scope D).
//
// Production agent prompts spend 55%+ of their token budget on tool
// schemas rather than persona. This module encodes that reality as an
// explicit, testable contract:
//
//   total tool budget = floor(promptBudget * TOOL_BUDGET_RATIO)   // 0.55
//   per-tool warning  = a single tool consuming more than
//                       PER_TOOL_WARNING_RATIO (10%) of the tool budget
//                       produces a WARNING — never a drop. Drops happen
//                       only on TOTAL overflow and live in
//                       descriptions.js (render/select), which drop the
//                       lowest-priority tools first, atomically.
//
// Units: chars (JS string length), the same unit Scope B reports as
// charCount. UTF-8 byte length can diverge from char count (see the
// byte model in prompt/assembly/boundary.js); every tool registered
// from the real Phase 5 / Phase 11 domains renders ASCII-only text, so
// the two agree in practice. charCount remains the contract.

import { PromptError } from '../assembly/errors.js';

/** Fraction of the whole prompt budget that tool descriptions may use. */
export const TOOL_BUDGET_RATIO = 0.55;

/** Per-tool warning threshold as a fraction of the TOTAL tool budget. */
export const PER_TOOL_WARNING_RATIO = 0.1;

/**
 * Total tool-budget size in chars for a given whole-prompt budget.
 * floor() keeps the computation integer and deterministic.
 */
export function toolBudgetChars(promptBudget) {
  return Math.floor(promptBudget * TOOL_BUDGET_RATIO);
}

/** Percentage of `budgetChars` used by `usedChars`, 2-decimal, deterministic. */
function pctOf(usedChars, budgetChars) {
  return Math.round((usedChars / budgetChars) * 10000) / 100;
}

/**
 * Parse a rendered block back into per-tool sections.
 * Sections are delimited by the canonical heading line `### <tool_slug>`
 * (see descriptions.js renderToolText). Returns [{ id, chars }].
 */
function toolSections(block) {
  if (block === '') return [];
  const sections = [];
  let current = null;
  for (const line of block.split('\n')) {
    const m = /^### ([a-z][a-z0-9_-]*)$/.exec(line);
    if (m) {
      current = { id: m[1], chars: line.length };
      sections.push(current);
    } else if (current) {
      current.chars += line.length + 1; // +1 for the joining newline
    }
  }
  return sections;
}

/**
 * Measure a rendered tool block against a whole-prompt budget.
 *
 * tools.budget(block, promptBudget) -> {
 *   fits,         boolean  - usedChars <= budgetChars
 *   usedPct,      number   - usage as % of the tool budget (2 decimals)
 *   usedChars,    number   - block.length
 *   budgetChars,  number   - floor(promptBudget * 0.55)
 *   warning?:     string   - per-tool 10% cap breaches (WARNING only)
 * }
 *
 * Refusals (PromptError codes):
 *   E_INVALID_BLOCK         - block is not a string
 *   E_INVALID_PROMPT_BUDGET - promptBudget not a positive finite number,
 *                             or the tool budget rounds down to 0 chars
 */
export function budget(block, promptBudget) {
  if (typeof block !== 'string') {
    throw new PromptError('E_INVALID_BLOCK', 'block must be a string', { got: typeof block });
  }
  if (typeof promptBudget !== 'number' || !Number.isFinite(promptBudget) || promptBudget <= 0) {
    throw new PromptError('E_INVALID_PROMPT_BUDGET', 'promptBudget must be a positive finite number', { got: promptBudget });
  }
  const budgetChars = toolBudgetChars(promptBudget);
  if (budgetChars < 1) {
    throw new PromptError(
      'E_INVALID_PROMPT_BUDGET',
      `tool budget rounds to ${budgetChars} chars; increase promptBudget`,
      { promptBudget, budgetChars },
    );
  }

  const usedChars = block.length;
  const fits = usedChars <= budgetChars;
  const result = {
    fits,
    usedPct: pctOf(usedChars, budgetChars),
    usedChars,
    budgetChars,
  };

  // Per-tool 10% cap: WARNING only — budget() never drops or truncates.
  // Integer math (chars * 10 > budgetChars) avoids float comparison edges.
  const breaches = toolSections(block)
    .filter((s) => s.chars * 10 > budgetChars)
    .map((s) => `${s.id} (${pctOf(s.chars, budgetChars)}%)`);
  if (breaches.length > 0) {
    result.warning =
      `per-tool cap exceeded (>${PER_TOOL_WARNING_RATIO * 100}% of tool budget): ${breaches.join(', ')}`;
  }

  return Object.freeze(result);
}

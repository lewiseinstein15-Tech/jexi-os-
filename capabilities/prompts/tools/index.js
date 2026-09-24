// prompt/tools/index.js
// Public surface of the tool description block (Phase 25, Scope D).
//
// Contract spellings:
//   tools.render(toolIds, opts)      -> { block, toolCount, charCount, dropped }
//   tools.budget(block, promptBudget) -> { fits, usedPct, usedChars, budgetChars, warning? }
//   tools.select(agentSpec, promptBudget) -> { toolIds, dropped }
//
// Wiring into the Scope A section registry: the rendered block feeds the
// canonical section `actions` ("Actions & Tool Use", order 5, static) —
// either through the canonical ctx-passthrough builder
// (`registry.get('actions').build({ actions: block })`) or by replacing
// the builder at a downstream layer (`build: () => block`), the same
// non-mutating substitution order.js documents for scope-specific builders.

import * as descriptions from './descriptions.js';
import * as budgetModule from './budget.js';

export const tools = Object.freeze({
  // contract trio
  render: descriptions.render,
  budget: budgetModule.budget,
  select: descriptions.select,
  // catalog plumbing (Scope A registry pattern: factory + shared default)
  createToolCatalog: descriptions.createToolCatalog,
  loadToolRegistry: descriptions.loadToolRegistry,
  defaultCatalog: descriptions.defaultCatalog,
  renderToolText: descriptions.renderToolText,
  // budget constants
  TOOL_BUDGET_RATIO: budgetModule.TOOL_BUDGET_RATIO,
  PER_TOOL_WARNING_RATIO: budgetModule.PER_TOOL_WARNING_RATIO,
  toolBudgetChars: budgetModule.toolBudgetChars,
});

export const render = descriptions.render;
export const select = descriptions.select;
export const budget = budgetModule.budget;
export { defaultCatalog } from './descriptions.js';
export { createToolCatalog, loadToolRegistry, renderToolText } from './descriptions.js';
export { TOOL_BUDGET_RATIO, PER_TOOL_WARNING_RATIO, toolBudgetChars } from './budget.js';

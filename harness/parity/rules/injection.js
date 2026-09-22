/** JEXI OS — Phase 30 Scope D — session and path-scoped rule injection. */
import { SemanticaError } from '../../../semantica/_internal.js';
import { matchRule } from './scope.js';
import { DEFAULT_TOKEN_BUDGET, snapshot, tokenBudget } from './rules.js';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function inject(filePath, options = {}) {
  const budget = options.tokenBudget === undefined ? (tokenBudget() ?? DEFAULT_TOKEN_BUDGET) : options.tokenBudget;
  if (!Number.isInteger(budget) || budget <= 0) {
    throw new SemanticaError('E_INVALID_RULE_BUDGET', `tokenBudget must be a positive integer; got ${String(budget)}`);
  }

  const candidates = snapshot().filter((rule) => rule.always || matchRule(rule, filePath));
  const kept = [...candidates];
  const dropped = [];
  let tokens = kept.reduce((sum, rule) => sum + rule.tokens, 0);
  while (tokens > budget && kept.length > 0) {
    const removed = kept.pop();
    tokens -= removed.tokens;
    dropped.push({ path: removed.path, priority: removed.priority, tokens: removed.tokens });
  }

  return {
    rules: kept.map(clone),
    tokens,
    budget,
    matchedCount: candidates.length,
    dropped,
    droppedCount: dropped.length,
  };
}

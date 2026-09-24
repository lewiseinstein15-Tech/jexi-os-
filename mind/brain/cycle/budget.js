/** JEXI OS — Phase 28 Scope I — deterministic per-phase USD caps. */
import { SemanticaError } from '../../../services/semantica/_internal.js';

export const DEFAULT_PHASE_BUDGETS = Object.freeze({
  lint: 0,
  backlinks: 0,
  sync: 0,
  extract: 0,
  'extract-facts': 0,
  'resolve-symbol-edges': 0,
  'synthesize-concepts': 0.25,
  'recompute-emotional-weight': 0,
  consolidate: 0,
  'propose-takes': 0.15,
  'grade-takes': 0.15,
  embed: 0,
  orphans: 0,
});

function money(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new SemanticaError('E_INVALID_ARGUMENT', `${field} must be a finite non-negative USD amount`);
  }
  return value;
}

export function createBudgetCaps(overrides = {}) {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
    throw new SemanticaError('E_INVALID_ARGUMENT', 'budget caps must be an object');
  }
  const caps = { ...DEFAULT_PHASE_BUDGETS };
  for (const [phase, value] of Object.entries(overrides)) {
    if (!Object.prototype.hasOwnProperty.call(caps, phase)) {
      throw new SemanticaError('E_INVALID_ARGUMENT', `unknown budget phase ${JSON.stringify(phase)}`);
    }
    caps[phase] = money(value, `budget cap ${phase}`);
  }
  return Object.freeze(caps);
}

export function checkPhaseBudget(name, used, caps) {
  if (!caps || typeof caps !== 'object' || !Object.prototype.hasOwnProperty.call(caps, name)) {
    throw new SemanticaError('E_INVALID_ARGUMENT', `missing budget cap for phase ${JSON.stringify(name)}`);
  }
  const budgetUsed = money(used ?? 0, `${name}.budgetUsed`);
  const cap = money(caps[name], `budget cap ${name}`);
  return {
    allowed: budgetUsed <= cap,
    budgetUsed,
    cap,
    ...(budgetUsed > cap ? {
      code: 'E_PHASE_BUDGET_EXCEEDED',
      message: `${name} budget $${budgetUsed.toFixed(6)} exceeds cap $${cap.toFixed(6)}`,
    } : {}),
  };
}

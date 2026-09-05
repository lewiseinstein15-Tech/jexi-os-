/**
 * JEXI OS — SIMULATION OF PLAN ALTERNATIVES (AGI Phase 9).
 *
 * Deterministic, keyless plan comparison (spec §36): before an expensive or
 * risky action, score candidate plans on
 *
 *   expectedSuccess — from step count and risky-step density
 *   cost            — estimated model calls + tool executions
 *   risk            — highest step risk
 *   reversibility   — any irreversible step makes the whole plan irreversible
 *
 * and rank with a REVERSIBLE-ACTION PREFERENCE: equal expected success →
 * the reversible plan wins; then cheaper; then lower risk.
 *
 * HONESTY (the rule that cannot bend): every prediction is a PREDICTED
 * epistemic claim (Phase B) — `prediction: true`. A prediction can never be
 * stored as an observation; only comparePredictedVsActual after real
 * execution settles what actually happened.
 */

import { makeClaim } from './Epistemics.js';

/**
 * Score one plan.
 * @param {object} plan { name, steps: [{ tool, risky?, irreversible?, modelCalls?, note? }] }
 */
export function scorePlan(plan) {
  const steps = Array.isArray(plan && plan.steps) ? plan.steps : [];
  const risky = steps.filter((s) => s && s.risky).length;
  const irreversible = steps.filter((s) => s && s.irreversible).length;
  const modelCalls = steps.reduce((n, s) => n + (Number(s && s.modelCalls) || 1), 0);
  const expectedSuccess = Math.max(0, Math.min(1, 1 - risky * 0.2 - steps.length * 0.02));
  return {
    name: String((plan && plan.name) || 'unnamed plan').slice(0, 120),
    steps: steps.length,
    riskySteps: risky,
    irreversibleSteps: irreversible,
    estimatedModelCalls: modelCalls,
    expectedSuccess: Math.round(expectedSuccess * 1000) / 1000,
    risk: risky === 0 ? 'low' : risky <= 2 ? 'medium' : 'high',
    reversibility: irreversible === 0 ? 'reversible' : 'irreversible',
    prediction: makeClaim({
      key: `plan:${(plan && plan.name) || 'unnamed'}`,
      value: { expectedSuccess: Math.round(expectedSuccess * 1000) / 1000, risk: risky === 0 ? 'low' : risky <= 2 ? 'medium' : 'high' },
      source: 'PREDICTED',
      confidence: 0.6,
      evidence: `deterministic estimate from ${steps.length} step(s), ${risky} risky, ${irreversible} irreversible`,
    }),
  };
}

/**
 * Simulate alternatives and rank them. Predictions are PREDICTED claims,
 * clearly separated from any observation (spec §36: never store a simulation
 * as a real event).
 * @returns { plans: [scored...], ranking: [names best-first], recommended, allPredictions }
 */
export function simulateAlternatives(plans) {
  const scored = (Array.isArray(plans) ? plans : []).map(scorePlan);
  const ranking = [...scored].sort((a, b) => {
    // 1) higher expected success, with a tolerance band (ties are real ties)
    if (Math.abs(b.expectedSuccess - a.expectedSuccess) > 0.05) return b.expectedSuccess - a.expectedSuccess;
    // 2) REVERSIBLE-ACTION PREFERENCE
    if (a.reversibility !== b.reversibility) return a.reversibility === 'reversible' ? -1 : 1;
    // 3) cheaper
    if (a.estimatedModelCalls !== b.estimatedModelCalls) return a.estimatedModelCalls - b.estimatedModelCalls;
    // 4) lower risk
    const rk = { low: 0, medium: 1, high: 2 };
    return rk[a.risk] - rk[b.risk];
  });
  return {
    plans: scored,
    ranking: ranking.map((p) => p.name),
    recommended: ranking[0] || null,
    allPredictions: scored.map((p) => p.prediction), // every one stamped PREDICTED
  };
}

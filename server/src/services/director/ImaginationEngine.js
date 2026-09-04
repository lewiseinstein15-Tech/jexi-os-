/**
 * B211 B2 — IMAGINATION ENGINE: bounded counterfactual strategy search.
 *
 * Before planning a COMPLEX/LONG_HORIZON mission, spend a SMALL bounded
 * budget of LLM calls imagining candidate strategies, judge them, select
 * one, and record PREDICTED outcomes. When the mission finishes, the
 * predicted outcome is compared against ACTUAL reality → deviation + lesson
 * (operational learning closes the loop).
 *
 * Bounds (hard, not aspirational):
 *   MAX_BRANCHES — at most 3 candidate strategies survive
 *   MAX_LLM_CALLS — at most 2 model calls total (generate + judge)
 *   MAX_CHARS   — prompt/output size caps
 * There is NO recursive simulation and no pretending depth that didn't run.
 *
 * Honesty rules:
 *   - no lane available / generation fails → status SIMULATION_UNAVAILABLE
 *     with the real reason; planning proceeds WITHOUT a simulated strategy.
 *     Never faked, never retried into oblivion.
 *   - a selected strategy is a PLAN INPUT, clearly labeled simulated — it is
 *     never a result. PREDICTED stays PREDICTED until reality is compared.
 *   - branch statuses are real: CREATED → SELECTED | REJECTED (with reasons)
 */

import { parseModelJson } from './JsonRepair.js';

export const IMAGINATION_BUDGETS = {
  MAX_BRANCHES: 3,
  MAX_LLM_CALLS: 2,
  MAX_CHARS: 6000,
};

let __branchSeq = 0;
const nextBranchId = () => `strat-${Date.now().toString(36)}-${String(++__branchSeq).padStart(2, '0')}`;

/**
 * Run one bounded imagination pass.
 * @param {object} args
 * @param {string} args.objective
 * @param {object} [args.analysis]  the ComplexityAnalyzer verdict
 * @param {string} [args.lessonsBlock]  operational lessons context (optional)
 * @param {Function} [args.llm]  ({ system, user }) => Promise<string>
 * @returns {Promise<object>} persisted on mission.imagination:
 *   { status: 'COMPLETED'|'SIMULATION_UNAVAILABLE', reason?, simulated,
 *     branches: [{id,name,approach,predictedOutcome,predictedRisks,predictedItems,status,rejectedBecause?}],
 *     selectedId, judgedBy, cost: {llmCalls, chars}, at }
 */
export async function imagine({ objective, analysis, lessonsBlock = '', llm } = {}) {
  const cost = { llmCalls: 0, chars: 0 };
  const unavailable = (reason) => ({
    status: 'SIMULATION_UNAVAILABLE', reason, simulated: false,
    branches: [], selectedId: null, judgedBy: null, cost, at: new Date().toISOString(),
  });

  if (typeof llm !== 'function') return unavailable('no model lane configured');

  const context = [
    `# MISSION OBJECTIVE\n"${String(objective || '').slice(0, 2000)}"`,
    analysis ? `# CLASSIFICATION\n${analysis.complexity} / risk ${analysis.risk}` : '',
    lessonsBlock ? lessonsBlock.slice(0, 1500) : '',
  ].filter(Boolean).join('\n\n');

  /* ── call 1: generate bounded candidate strategies ─────────────────── */
  let candidates;
  try {
    const system = [
      'You are JEXI — the Director running a COUNTERFACTUAL STRATEGY pass (imagination, not execution).',
      'Propose DIFFERENT viable strategies for this mission. This is simulation only: nothing runs now.',
      `At most ${IMAGINATION_BUDGETS.MAX_BRANCHES} candidates. Each must be genuinely different in APPROACH (not wording):`,
      'different order of work, different decomposition, different tooling — not three flavors of the same plan.',
      'For each: a short name, the approach, the PREDICTED outcome if it works, the main risks, and a rough item count.',
      'Output ONLY JSON: {"candidates":[{"name":"...","approach":"...","predictedOutcome":"...","predictedRisks":"...","predictedItems":3}]}',
    ].join('\n');
    cost.llmCalls += 1;
    const raw = await llm({ system, user: context });
    cost.chars += String(raw || '').length;
    const parsed = parseModelJson(String(raw || '').slice(0, IMAGINATION_BUDGETS.MAX_CHARS));
    const list = Array.isArray(parsed && parsed.candidates) ? parsed.candidates : [];
    candidates = list
      .filter((c) => c && typeof c === 'object' && String(c.name || '').trim() && String(c.approach || '').trim())
      .slice(0, IMAGINATION_BUDGETS.MAX_BRANCHES);
  } catch (e) {
    return unavailable(`generation failed: ${String(e && e.message || e).slice(0, 120)}`);
  }
  if (!candidates.length) return unavailable('no valid candidate strategies produced');
  if (cost.llmCalls >= IMAGINATION_BUDGETS.MAX_LLM_CALLS && candidates.length > 1) {
    // generation consumed the budget: select deterministically, honestly
    const branches = candidates.map((c, i) => makeBranch(c, i, i === 0 ? 'SELECTED' : 'REJECTED', i === 0 ? 'generation used the call budget — first viable candidate selected' : 'not selected (judge budget spent)'));
    return finish(branches, branches[0].id, 'first-viable (budget)', cost);
  }

  const branches = candidates.map((c) => makeBranch(c, null, 'CREATED', ''));

  /* ── single-candidate: nothing to judge ────────────────────────────── */
  if (branches.length === 1) {
    branches[0].status = 'SELECTED';
    return finish(branches, branches[0].id, 'only-candidate', cost);
  }

  /* ── call 2: judge — pick ONE, reject the rest with reasons ────────── */
  try {
    const system = [
      'You are JEXI — the Director acting as STRATEGY JUDGE.',
      'Below are candidate strategies imagined (simulated, nothing executed) for one mission. Select exactly ONE to plan against.',
      'Judge by: fit to the objective, fewest irreversible steps, verifiability, and risk. Cite the candidates by name.',
      'Output ONLY JSON: {"selectedName":"...","verdicts":[{"name":"...","because":"one short line — why selected or rejected"}]}',
    ].join('\n');
    const user = `${context}\n\n# CANDIDATE STRATEGIES (simulated)\n${JSON.stringify(candidates.map((c) => ({ name: c.name, approach: c.approach, predictedRisks: c.predictedRisks })), null, 2).slice(0, 3500)}`;
    cost.llmCalls += 1;
    const raw = await llm({ system, user });
    cost.chars += String(raw || '').length;
    const parsed = parseModelJson(String(raw || '').slice(0, IMAGINATION_BUDGETS.MAX_CHARS));
    const selectedName = String(parsed && parsed.selectedName || '').trim();
    const verdicts = new Map((Array.isArray(parsed && parsed.verdicts) ? parsed.verdicts : [])
      .filter((v) => v && v.name).map((v) => [String(v.name).trim(), String(v.because || '').slice(0, 200)]));

    const selected = branches.find((b) => b.name === selectedName) || branches[0];
    for (const b of branches) {
      if (b === selected) { b.status = 'SELECTED'; b.verdict = verdicts.get(b.name) || 'selected by the judge'; }
      else { b.status = 'REJECTED'; b.rejectedBecause = verdicts.get(b.name) || 'not selected by the judge'; }
    }
    return finish(branches, selected.id, 'llm-judge', cost);
  } catch {
    for (const [i, b] of branches.entries()) {
      if (i === 0) { b.status = 'SELECTED'; b.verdict = 'judge lane unavailable — first viable candidate selected (honest fallback)'; }
      else { b.status = 'REJECTED'; b.rejectedBecause = 'judge lane unavailable'; }
    }
    return finish(branches, branches[0].id, 'fallback (judge unavailable)', cost);
  }
}

function makeBranch(c, _i, status, verdict) {
  const items = Number(c.predictedItems);
  return {
    id: nextBranchId(),
    name: String(c.name).slice(0, 120),
    approach: String(c.approach).slice(0, 900),
    predictedOutcome: String(c.predictedOutcome || '').slice(0, 500),
    predictedRisks: String(c.predictedRisks || '').slice(0, 400),
    predictedItems: Number.isFinite(items) && items > 0 ? Math.min(Math.round(items), 30) : null,
    status, ...(verdict ? { verdict } : {}),
  };
}

function finish(branches, selectedId, judgedBy, cost) {
  return {
    status: 'COMPLETED', simulated: true, branches, selectedId, judgedBy, cost,
    at: new Date().toISOString(),
  };
}

/**
 * Compare the selected strategy's PREDICTED outcome against ACTUAL mission
 * reality. Deterministic — computed from real numbers, never invented.
 * @param {object} imagination  the mission's stored imagination pass
 * @param {object} actual  { verdict, score, itemsTotal, itemsDone, itemsFailed, replans, elapsedMs }
 */
export function comparePredictedVsActual(imagination, actual) {
  const selected = (imagination && imagination.branches || []).find((b) => b.id === imagination.selectedId) || null;
  if (!selected) return null;
  const predictedItems = selected.predictedItems;
  const itemsDelta = predictedItems !== null && Number.isFinite(actual.itemsTotal)
    ? actual.itemsTotal - predictedItems : null;
  const outcomeMatched = actual.verdict === 'pass';
  const parts = [];
  if (predictedItems !== null) parts.push(`predicted ~${predictedItems} work item(s), reality took ${actual.itemsTotal} (${itemsDelta >= 0 ? '+' : ''}${itemsDelta})`);
  parts.push(`predicted outcome "${String(selected.predictedOutcome).slice(0, 120)}" — actual verdict: ${actual.verdict}${Number.isFinite(actual.score) ? ` (${actual.score})` : ''}`);
  if (actual.itemsFailed > 0) parts.push(`${actual.itemsFailed} item(s) failed along the way (predicted risks: ${String(selected.predictedRisks || 'none stated').slice(0, 120)})`);
  if (actual.replans > 0) parts.push(`${actual.replans} replan round(s) were needed`);
  const lesson = [
    `Strategy "${selected.name}" (${imagination.judgedBy}):`,
    parts.join('. '),
    outcomeMatched && !actual.itemsFailed && !actual.replans
      ? 'Prediction held — this strategy shape worked; reuse it for similar objectives.'
      : 'Prediction deviated — treat the approach sketch as a hypothesis, not a promise, and plan verification earlier.',
  ].join(' ').slice(0, 900);
  return {
    strategy: selected.name,
    predicted: { outcome: selected.predictedOutcome, items: predictedItems, risks: selected.predictedRisks },
    actual: { verdict: actual.verdict, score: actual.score ?? null, itemsTotal: actual.itemsTotal ?? null, itemsFailed: actual.itemsFailed ?? null, replans: actual.replans ?? null },
    itemsDelta, outcomeMatched,
    lesson,
    at: new Date().toISOString(),
  };
}

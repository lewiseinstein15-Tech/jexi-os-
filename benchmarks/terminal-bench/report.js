/**
 * JEXI OS — benchmarks/terminal-bench/report.js
 *
 * Per-task results + aggregate pass rate for a Terminal-Bench 2.1 run.
 *
 * Shape:
 * {
 *   benchmark: 'terminal-bench', version: '2.1', split, fixture,
 *   resolved, total, rate,
 *   rejected: [ { index, task_id, code, reason } ],   // malformed entries
 *   perTask: [ { task_id, category, difficulty, instruction,
 *                submitted, stepsUsed, resolved, actions, verifier } ]
 * }
 *
 * Resolution semantics: a task counts as resolved only when the agent
 * actually submitted AND the verifier verdict is true. `total` counts
 * EVALUATED (valid) tasks; the malformed entries the loader rejected are
 * listed under `rejected` — never silent.
 *
 * Fixed key construction order + plain divisions keep JSON serialization
 * byte-stable across runs (no timestamps, no randomness — probed in P7).
 */

export function buildReport({ split = 'mini', fixture = null, evaluated, rejected = [] }) {
  if (!Array.isArray(evaluated)) {
    const err = new Error('tb.buildReport: evaluated array is required');
    err.code = 'TB_REPORT_BAD_INPUT';
    throw err;
  }

  const perTask = evaluated.map((e) => ({
    task_id: e.task_id,
    category: e.category ?? '',
    difficulty: e.difficulty ?? '',
    instruction: e.instruction ?? '',
    submitted: e.submitted === true,
    stepsUsed: e.stepsUsed,
    resolved: e.resolved === true,
    actions: e.actions,
    verifier: e.verifier,
  }));

  const total = perTask.length;
  const resolved = perTask.filter((r) => r.resolved).length;

  return {
    benchmark: 'terminal-bench',
    version: '2.1',
    split,
    fixture,
    resolved,
    total,
    rate: total ? resolved / total : 0,
    rejected: rejected.map((r) => ({
      index: r.index,
      task_id: r.task_id,
      code: r.code,
      reason: r.reason,
    })),
    perTask,
  };
}

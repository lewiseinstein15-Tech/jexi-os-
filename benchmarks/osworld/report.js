/**
 * JEXI OS — benchmarks/osworld/report.js
 *
 * Per-app / per-category results + pass@1 for an OSWorld run.
 *
 * Shape:
 * {
 *   benchmark: 'osworld', version: 'v1', split, fixture,
 *   passAt1,          // mean over tasks of the per-task rate (the OSWorld
 *                     // "Pass@1 averaged over N runs" estimator)
 *   perApp: [ { app, total, passed, rate }, ... ],      // frozen APPS order
 *   perCategory: [ { category, total, passed, rate }, ... ], // alphabetical
 *   perTask: [ { task_id, app, category, runs, runsPassed, rate,
 *                stepsUsed, rules, actions, runVerdicts } ],
 *   rejected: [ { index, task_id, code, reason } ]     // malformed entries
 * }
 *
 * Counting units: perApp/perCategory `total` counts TASK-RUN INSTANCES
 * (tasks x runsPerTask — with the scope-17 real run that is tasks x 5,
 * matching the OSWorld "averaged over 5 runs" discipline); `passed` counts
 * the instances whose episode ended in a pass verdict. With the sandbox
 * default runsPerTask=1 the instances are the tasks themselves. passAt1 is
 * the mean of the per-task rates (runsPassed / runs).
 *
 * perTask carries the FIRST run's episode detail (stepsUsed, rule results,
 * action trace); runVerdicts carries every run's boolean verdict. In the
 * deterministic sandbox all runs of a task are identical; in the real run
 * the runVerdicts array is where run-to-run variance surfaces.
 *
 * Fixed key construction order + plain divisions keep JSON serialization
 * byte-stable across runs (no timestamps, no randomness — probed in P7).
 */

export function buildReport({ split = 'mini', fixture = null, evaluated, rejected = [], appsOrder }) {
  if (!Array.isArray(evaluated)) {
    const err = new Error('osw.buildReport: evaluated array is required');
    err.code = 'OSW_REPORT_BAD_INPUT';
    throw err;
  }
  if (!Array.isArray(appsOrder) || appsOrder.length === 0) {
    const err = new Error('osw.buildReport: appsOrder array is required');
    err.code = 'OSW_REPORT_BAD_INPUT';
    throw err;
  }

  const perTask = evaluated.map((e) => ({
    task_id: e.task_id,
    app: e.app,
    category: e.category,
    runs: e.runs,
    runsPassed: e.runsPassed,
    rate: e.runs ? e.runsPassed / e.runs : 0,
    stepsUsed: e.stepsUsed,
    rules: e.rules ?? [],
    actions: e.actions,
    runVerdicts: [...(e.runVerdicts ?? [])],
  }));

  const perApp = appsOrder
    .map((app) => {
      const rows = perTask.filter((t) => t.app === app);
      if (!rows.length) return null;
      const total = rows.reduce((acc, r) => acc + r.runs, 0);
      const passed = rows.reduce((acc, r) => acc + r.runsPassed, 0);
      return { app, total, passed, rate: total ? passed / total : 0 };
    })
    .filter(Boolean);

  const categoryNames = [...new Set(perTask.map((t) => t.category))].sort();
  const perCategory = categoryNames.map((category) => {
    const rows = perTask.filter((t) => t.category === category);
    const total = rows.reduce((acc, r) => acc + r.runs, 0);
    const passed = rows.reduce((acc, r) => acc + r.runsPassed, 0);
    return { category, total, passed, rate: total ? passed / total : 0 };
  });

  const passAt1 = perTask.length
    ? perTask.reduce((acc, r) => acc + r.rate, 0) / perTask.length
    : 0;

  return {
    benchmark: 'osworld',
    version: 'v1',
    split,
    fixture,
    passAt1,
    perApp,
    perCategory,
    perTask,
    rejected: rejected.map((r) => ({
      index: r.index,
      task_id: r.task_id,
      code: r.code,
      reason: r.reason,
    })),
  };
}

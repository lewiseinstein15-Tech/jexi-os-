/**
 * JEXI OS — benchmarks/webarena/report.js
 *
 * Per-site results + overall success rate for a WebArena Verified run.
 *
 * Shape:
 * {
 *   benchmark: 'webarena-verified', version: 'v1', split, fixture,
 *   overall: { passed, total, rate },
 *   perSite: [ { site, total, passed, rate }, ... ],   // frozen site order
 *   perTask: [ { task_id, sites, stepsUsed, passed, evaluatorKinds,
 *                actions, rules } ],
 *   rejected: [ { index, task_id, code, reason } ]     // malformed entries
 * }
 *
 * Tasks are grouped under their PRIMARY site (sites[0] — the dataset's
 * per-task site list is length-1 in practice); perSite lists only sites
 * with at least one evaluated task, in frozen SITES order.
 *
 * Fixed key construction order + plain divisions keep JSON serialization
 * byte-stable across runs (no timestamps, no randomness — probed in P7).
 */

export function buildReport({ split = 'mini', fixture = null, evaluated, rejected = [], sitesOrder }) {
  if (!Array.isArray(evaluated)) {
    const err = new Error('wa.buildReport: evaluated array is required');
    err.code = 'WA_REPORT_BAD_INPUT';
    throw err;
  }
  if (!Array.isArray(sitesOrder) || sitesOrder.length === 0) {
    const err = new Error('wa.buildReport: sitesOrder array is required');
    err.code = 'WA_REPORT_BAD_INPUT';
    throw err;
  }

  const perTask = evaluated.map((e) => ({
    task_id: e.task_id,
    sites: [...(e.sites ?? [])],
    stepsUsed: e.stepsUsed,
    passed: e.passed === true,
    evaluatorKinds: [...(e.evaluatorKinds ?? [])],
    actions: e.actions,
    rules: e.rules ?? [],
  }));

  const perSite = sitesOrder
    .map((site) => {
      const rows = perTask.filter((t) => (t.sites[0] ?? '') === site);
      if (!rows.length) return null;
      const passed = rows.filter((r) => r.passed).length;
      return { site, total: rows.length, passed, rate: rows.length ? passed / rows.length : 0 };
    })
    .filter(Boolean);

  const total = perTask.length;
  const passed = perTask.filter((r) => r.passed).length;

  return {
    benchmark: 'webarena-verified',
    version: 'v1',
    split,
    fixture,
    overall: { passed, total, rate: total ? passed / total : 0 },
    perSite,
    perTask,
    rejected: rejected.map((r) => ({
      index: r.index,
      task_id: r.task_id,
      code: r.code,
      reason: r.reason,
    })),
  };
}

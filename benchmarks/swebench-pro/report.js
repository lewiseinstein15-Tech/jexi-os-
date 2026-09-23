/**
 * JEXI OS — benchmarks/swebench-pro/report.js
 *
 * Per-instance results + aggregate pass rate for a SWE-bench Pro run.
 *
 * Shape:
 * {
 *   benchmark, split, fixture,
 *   resolved, total, rate,
 *   rejected: [ { index, instance_id, code, reason } ],   // malformed entries
 *   perInstance: [ { instance_id, repo, language, failToPass, passToPass,
 *                    resolved, tests: { failToPass, passToPass } } ]
 * }
 *
 * `total` counts EVALUATED (valid) instances; the malformed entries the
 * loader rejected are listed under `rejected` — never silent. Fixed key
 * construction order + plain divisions keep JSON serialization
 * byte-stable across runs.
 */

export function buildReport({ split = 'mini', fixture = null, evaluated, rejected = [] }) {
  if (!Array.isArray(evaluated)) {
    const err = new Error('swepro.buildReport: evaluated array is required');
    err.code = 'SWEBENCH_REPORT_BAD_INPUT';
    throw err;
  }

  const perInstance = evaluated.map((e) => ({
    instance_id: e.instance_id,
    repo: e.repo ?? '',
    language: e.language ?? '',
    failToPass: e.failToPass,
    passToPass: e.passToPass,
    resolved: e.resolved,
    tests: {
      failToPass: Array.isArray(e.tests) ? e.tests.filter((t) => t.kind === 'FAIL_TO_PASS').length : 0,
      passToPass: Array.isArray(e.tests) ? e.tests.filter((t) => t.kind === 'PASS_TO_PASS').length : 0,
    },
  }));

  const total = perInstance.length;
  const resolved = perInstance.filter((r) => r.resolved).length;

  return {
    benchmark: 'swebench-pro',
    split,
    fixture,
    resolved,
    total,
    rate: total ? resolved / total : 0,
    rejected: rejected.map((r) => ({
      index: r.index,
      instance_id: r.instance_id,
      code: r.code,
      reason: r.reason,
    })),
    perInstance,
  };
}

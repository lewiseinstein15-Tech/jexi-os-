/**
 * JEXI OS — benchmarks/gaia/report.js
 *
 * gaia report builder: per-level (1/2/3) + overall success rate.
 *
 * Shape (per the Scope 11 contract):
 * {
 *   benchmark, split, fixture,
 *   perLevel: { 1: {total, passed, rate}, 2: {...}, 3: {...} },
 *   overall:  { total, passed, rate },
 *   perTask:  [ { task_id, level, pipeline, pass, answer, normalized, expected } ]
 * }
 *
 * Determinism: object literal key order is fixed (construction order),
 * rates are plain divisions (stable IEEE-754 doubles), and no field
 * carries wall-clock or randomness — the same fixture + same injected
 * pipeline always serialize to byte-identical JSON.
 */

export function buildReport({ split = 'validation', fixture = null, perTask }) {
  if (!Array.isArray(perTask)) {
    const err = new Error('gaia.buildReport: perTask array is required');
    err.code = 'GAIA_REPORT_BAD_INPUT';
    throw err;
  }

  const perLevel = {};
  for (const level of [1, 2, 3]) {
    const rows = perTask.filter((r) => r.level === level);
    const passed = rows.filter((r) => r.pass).length;
    perLevel[level] = {
      total: rows.length,
      passed,
      rate: rows.length ? passed / rows.length : 0,
    };
  }

  const total = perTask.length;
  const passed = perTask.filter((r) => r.pass).length;

  return {
    benchmark: 'gaia',
    split,
    fixture,
    perLevel,
    overall: { total, passed, rate: total ? passed / total : 0 },
    perTask: perTask.map((r) => ({
      task_id: r.task_id,
      level: r.level,
      pipeline: r.pipeline ?? null,
      pass: r.pass,
      answer: r.answer,
      normalized: r.normalized,
      expected: r.expected,
    })),
  };
}

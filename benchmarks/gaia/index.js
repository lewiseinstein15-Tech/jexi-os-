/**
 * JEXI OS — benchmarks/gaia/index.js
 *
 * Public API (Phase 31 Scope 11 contract):
 *   gaia.load({ split, fixturePath? })            -> tasks[]
 *   gaia.dispatch(task, { pipeline })             -> { answer, trace }
 *   gaia.score(task, answer)                      -> { pass, normalized, expected }
 *   gaia.run({ fixture, split?, pipeline })       -> { perLevel: {1,2,3}, overall, perTask[] }
 *
 * run() orchestrates load -> dispatch (injected pipeline) -> score -> report.
 * The pipeline is caller-supplied: a deterministic stub over the fixture in
 * the sandbox, the real chat pipeline in the scope 17 live run.
 */

import { load, loadFixture, loadHf, FIXTURES } from './dataset.js';
import { dispatch } from './dispatch.js';
import { normalizeAnswer, score } from './score.js';
import { buildReport } from './report.js';

export async function run({ fixture, split = 'validation', pipeline } = {}) {
  const tasks = await load({ split, fixturePath: fixture });

  const perTask = [];
  for (const task of tasks) {
    const dispatched = await dispatch(task, { pipeline });
    const scored = score(task, dispatched.answer);
    perTask.push({
      task_id: task.task_id,
      level: task.level,
      pipeline: dispatched.trace.pipeline,
      pass: scored.pass,
      answer: dispatched.answer,
      normalized: scored.normalized,
      expected: scored.expected,
    });
  }

  return buildReport({
    split,
    fixture: fixture ?? `bundled:${split}`,
    perTask,
  });
}

export const gaia = { load, loadFixture, loadHf, dispatch, score, normalizeAnswer, buildReport, run, FIXTURES };
export { load, loadFixture, loadHf, dispatch, score, normalizeAnswer, buildReport, FIXTURES };
export default gaia;

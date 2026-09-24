/**
 * JEXI OS — benchmarks/gaia/dispatch.js
 *
 * gaia.dispatch(task, { pipeline }) -> { answer, trace }
 *
 * The pipeline is INJECTED, never imported:
 * - sandbox (scope 11, build-only): a deterministic stub supplied by the
 *   caller (probe) that returns the fixture's expected answer;
 * - live run (scope 17): the real JEXI chat pipeline
 *   (prompt-assembly -> provider-bridge).
 *
 * The request handed to the pipeline mirrors a GAIA task's model-facing
 * surface: task_id, level, question, file_name. The pipeline may return
 * a plain string or { answer, trace? }; a returned object trace is
 * merged under the dispatch base trace. No timestamps, no randomness:
 * traces are fully deterministic.
 */

export async function dispatch(task, { pipeline } = {}) {
  if (!task || typeof task.task_id !== 'string') {
    const err = new Error('gaia.dispatch: a GAIA task with a string task_id is required');
    err.code = 'GAIA_DISPATCH_BAD_TASK';
    throw err;
  }
  if (typeof pipeline !== 'function') {
    const err = new Error(
      'gaia.dispatch: an injected pipeline function is required ' +
      '(sandbox: deterministic stub over the fixture; scope 17: real chat pipeline)'
    );
    err.code = 'GAIA_PIPELINE_REQUIRED';
    throw err;
  }

  const request = Object.freeze({
    task_id: task.task_id,
    level: task.level,
    question: task.question,
    file_name: task.file_name ?? '',
  });

  const out = await pipeline(request);
  const answer = typeof out === 'string' ? out : out?.answer;
  if (answer === undefined || answer === null || String(answer) === '') {
    const err = new Error(`gaia.dispatch: pipeline returned no answer for task ${task.task_id}`);
    err.code = 'GAIA_DISPATCH_NO_ANSWER';
    throw err;
  }

  const baseTrace = {
    task_id: task.task_id,
    level: task.level,
    pipeline: pipeline.name || 'anonymous',
  };
  const extra = out && typeof out === 'object' && !Array.isArray(out) ? out.trace : undefined;
  const trace =
    extra && typeof extra === 'object' && !Array.isArray(extra)
      ? { ...baseTrace, ...extra }
      : extra !== undefined
        ? { ...baseTrace, detail: extra }
        : baseTrace;

  return { answer: String(answer), trace };
}

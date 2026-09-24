/**
 * JEXI OS — Phase 20 Scope D — the Looper (iterative refinement loop).
 *
 * Ported from the ruflo looper pattern: re-run a task with feedback until a
 * stop condition is met.
 *
 *   looper.run(task, { maxIterations, stopWhen, onIteration, input })
 *     -> { iterations, finalResult, stoppedBy }
 *        stoppedBy: 'stop-condition' | 'max-iterations' | 'error'
 *
 * `task` is the unit of work: a function (prevResult, n) -> nextResult, or
 * an object { fn }. The first iteration receives `opts.input` (default
 * undefined); every later iteration receives the previous result.
 *
 * Semantics:
 * - stopWhen(result, n) is checked AFTER the callback of each completed
 *   iteration; the first true stops the loop (that iteration counts).
 * - onIteration({ n, result }) fires after every completed step, including
 *   the final one. Errors in the callback PROPAGATE — never swallowed.
 * - An error thrown by the task itself stops the loop with stoppedBy
 *   'error'; the returned record carries the error and the count of
 *   COMPLETED iterations.
 * - maxIterations hard cap (default 10): exceeding it stops with
 *   'max-iterations'. `iterations` is always the ACTUAL completed count,
 *   never the cap.
 * - Deterministic given the same task and predicate.
 */
import { SwarmError } from '../topologies/_internal.js';

export const DEFAULT_MAX_ITERATIONS = 10;

export function run(task, opts = {}) {
  const {
    maxIterations = DEFAULT_MAX_ITERATIONS,
    stopWhen,
    onIteration,
    input,
  } = opts;

  if (!Number.isInteger(maxIterations) || maxIterations < 1) {
    throw new SwarmError('E_INVALID_MAX_ITERATIONS', `maxIterations must be an integer >= 1, got ${JSON.stringify(maxIterations)}`);
  }
  if (stopWhen !== undefined && typeof stopWhen !== 'function') {
    throw new SwarmError('E_INVALID_STOP_WHEN', `stopWhen must be a function or undefined, got ${typeof stopWhen}`);
  }
  if (onIteration !== undefined && typeof onIteration !== 'function') {
    throw new SwarmError('E_INVALID_CALLBACK', `onIteration must be a function or undefined, got ${typeof onIteration}`);
  }
  const step = typeof task === 'function' ? task : task && task.fn;
  if (typeof step !== 'function') {
    throw new SwarmError('E_INVALID_TASK', 'task must be a function (prev, n) => next or an object { fn }');
  }

  let result = input;
  let n = 0;
  while (n < maxIterations) {
    n += 1;
    try {
      result = step(result, n);
    } catch (err) {
      return {
        iterations: n - 1, // completed iterations only
        finalResult: result,
        stoppedBy: 'error',
        error: { attempt: n, message: err.message },
      };
    }
    if (onIteration) onIteration({ n, result });
    if (stopWhen && stopWhen(result, n) === true) {
      return { iterations: n, finalResult: result, stoppedBy: 'stop-condition' };
    }
  }
  return { iterations: n, finalResult: result, stoppedBy: 'max-iterations' };
}

export default { DEFAULT_MAX_ITERATIONS, run };

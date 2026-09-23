/**
 * JEXI OS — benchmarks/terminal-bench/agent.js
 *
 * JEXI agent interface that the official Terminal-Bench runner invokes:
 *
 *   tb.agent({ pipeline }) -> agent
 *     agent.step(observation) -> { action, args }   (async)
 *     agent.done()            -> { finished: bool }
 *
 * agent.step() is the JEXI seam:
 * - the observation (raw capture or already-normalized) is normalized
 *   through tb.observe(): ANSI stripped, exit code separate, blank lines
 *   and trailing whitespace preserved;
 * - the pipeline decides the next move:
 *     pipeline({ task?, observation, history }) -> { action, args }
 *   sandbox runs (scope 13) inject a stub pipeline with pre-declared
 *   actions; the real run (scope 17) injects the live chat pipeline;
 * - the proposal is validated against the frozen v1 action space and the
 *   first error is thrown on failure — the agent NEVER returns an invalid
 *   action to the runner side;
 * - stepping after submit is refused (TB_AGENT_FINISHED): once the task
 *   is submitted the trace is closed.
 *
 * `history` passed to the pipeline is the append-only list of prior
 * steps: [ { observation, action, args }, ... ] — first call sees [].
 *
 * Deterministic given a deterministic pipeline: no wall-clock, no
 * randomness.
 */

import { observe } from './observation.js';
import { validate } from './actions.js';

export function createAgent({ pipeline } = {}) {
  if (typeof pipeline !== 'function') {
    const err = new Error(
      'tb.agent: pipeline is required (function({ task?, observation, history }) -> { action, args })'
    );
    err.code = 'TB_PIPELINE_REQUIRED';
    throw err;
  }
  let history = [];
  let submitted = false;

  return {
    async step(observation, { task } = {}) {
      if (submitted) {
        const err = new Error('agent.step() after submit — the task trace is closed');
        err.code = 'TB_AGENT_FINISHED';
        throw err;
      }
      const normalized = observe(observation);
      const pipelineInput = {
        ...(task !== undefined ? { task } : {}),
        observation: normalized,
        history,
      };
      const proposed = await pipeline(pipelineInput);
      const verdict = validate(proposed);
      if (!verdict.valid) throw verdict.errors[0];
      const action = proposed.action;
      const args = proposed.args ?? {};
      if (action === 'submit') submitted = true;
      history.push({ observation: normalized, action, args });
      return { action, args };
    },

    done() {
      return { finished: submitted };
    },
  };
}

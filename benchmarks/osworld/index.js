/**
 * JEXI OS — benchmarks/osworld/index.js
 *
 * Public API (Phase 31 Scope 15 contract):
 *   osw.load({ split, fixturePath? })                     -> tasks[]
 *   osw.adapter({ mode, computer })                       -> { step(observation) -> { action, args, trace } }
 *   osw.observe(rawState)                                 -> { screenshot, instruction, cwd, screenSize, appFocus }
 *   osw.evaluate(task, finalState)                        -> { pass, rules }
 *   osw.run({ fixture, agent, evaluate, runsPerTask? })   -> { perApp, perCategory, passAt1, perTask[], ... }
 *
 * run() orchestrates: load -> resolve the fixture's sibling observations
 * (pre-recorded screenshot+state snapshots) -> per task, per run: fresh
 * episode, replay every snapshot through agent.step() (the injected adapter
 * IS the agent), evaluate the task's evaluator against the FINAL snapshot ->
 * report with pass@1 over runsPerTask runs. The agent and evaluator are
 * INJECTED:
 * - sandbox (scope 15): osw.adapter(...) over a stub computer; evaluate =
 *   the rule-based default (or an equivalent injection);
 * - real run (scope 17): the adapter over the real Phase 29 computer agent
 *   against the real desktop VM; evaluate = the VM-backed evaluators;
 *   runsPerTask: 5 (OSWorld Pass@1 averaged over 5 runs).
 *
 * No live VM, no Docker, no model call. The adapter consumes Phase 29
 * READ-ONLY through injection; nothing here imports or edits computer/**.
 */

import path from 'node:path';
import {
  load,
  loadDiagnostics,
  validateTask,
  loadObservations,
  validateObservations,
  loadReal,
  APPS,
  FIXTURES,
} from './tasks.js';
import {
  createAdapter,
  validateAction,
  translateJexi,
  ACTION_SPACE,
  ACTION_SPACE_VERSION,
  JEXI_PHASE29_SPACE,
  SCROLL_STEP,
  WAIT_DEFAULT_SECONDS,
} from './adapter.js';
import { observe } from './observation.js';
import { evaluate as ruleEvaluate, validateEvaluator, evaluatorRules } from './evaluator.js';
import { buildReport } from './report.js';

export async function run({
  fixture,
  split = 'mini',
  agent,
  evaluate = ruleEvaluate,
  runsPerTask = 1,
  observationsPath,
} = {}) {
  if (!agent || typeof agent.step !== 'function') {
    const err = new Error(
      'osw.run: an injected agent with step(observation) is required ' +
      "(sandbox: osw.adapter({ mode, computer }); scope 17: the adapter over the real Phase 29 computer agent)"
    );
    err.code = 'OSW_AGENT_REQUIRED';
    throw err;
  }
  if (typeof evaluate !== 'function') {
    const err = new Error(
      'osw.run: evaluate must be a function (task, finalState) -> { pass } ' +
      '(default: the rule-based evaluator; scope 17: VM-backed evaluators)'
    );
    err.code = 'OSW_EVALUATE_REQUIRED';
    throw err;
  }
  if (!Number.isInteger(runsPerTask) || runsPerTask <= 0) {
    const err = new Error(
      `osw.run: runsPerTask must be a positive integer (got ${JSON.stringify(runsPerTask)}); ` +
      'the scope-17 real run sets runsPerTask: 5 (OSWorld Pass@1 averaged over 5 runs)'
    );
    err.code = 'E_INVALID_ARGUMENT';
    err.field = 'runsPerTask';
    throw err;
  }

  const diag =
    fixture === null
      ? { tasks: await load({ split, fixturePath: null }), rejected: [], fixture: null, observationsRef: null } // gated: throws NOT VERIFIED
      : await loadDiagnostics({ split, fixturePath: fixture });

  // Resolve the observations fixture: explicit override wins; otherwise
  // the tasks fixture declares its sibling snapshot file.
  let observationsFile = observationsPath ?? null;
  if (!observationsFile) {
    if (!diag.observationsRef) {
      const err = new Error(
        'E_INVALID_OBSERVATION — fixture does not declare an observations file ' +
        '(add "observations": "<sibling file>" to the fixture or pass observationsPath)'
      );
      err.code = 'E_INVALID_OBSERVATION';
      throw err;
    }
    observationsFile = path.join(path.dirname(diag.fixture), diag.observationsRef);
  }
  const observations = await loadObservations(observationsFile);

  const evaluated = [];
  for (const task of diag.tasks) {
    const entry = observations.tasks[task.task_id];
    if (!entry) {
      const err = new Error(`E_INVALID_OBSERVATION — no observation trace for task "${task.task_id}"`);
      err.code = 'E_INVALID_OBSERVATION';
      throw err;
    }

    let firstRunActions = null;
    let firstRunRules = null;
    let stepsUsed = 0;
    const runVerdicts = [];

    for (let run = 0; run < runsPerTask; run++) {
      if (typeof agent.reset === 'function') agent.reset(); // fresh episode per run
      const actions = [];
      let finalState = null;
      for (const snap of entry.snapshots) {
        const obs = observe(snap);
        finalState = obs;
        const move = await agent.step(obs, { task });
        actions.push({ action: move.action, args: move.args });
      }
      const verdict = await evaluate(task, finalState);
      runVerdicts.push(verdict.pass === true);
      if (run === 0) {
        firstRunActions = actions;
        firstRunRules = verdict.rules ?? [];
        stepsUsed = actions.length;
      }
    }

    evaluated.push({
      task_id: task.task_id,
      app: task.app,
      category: task.category,
      runs: runsPerTask,
      runsPassed: runVerdicts.filter(Boolean).length,
      stepsUsed,
      rules: firstRunRules,
      actions: firstRunActions,
      runVerdicts,
    });
  }

  return buildReport({
    split,
    fixture: fixture ?? `bundled:${split}`,
    evaluated,
    rejected: diag.rejected,
    appsOrder: APPS,
  });
}

export const osw = {
  load,
  loadDiagnostics,
  validateTask,
  loadObservations,
  validateObservations,
  loadReal,
  adapter: createAdapter,
  observe,
  evaluate: ruleEvaluate,
  validateEvaluator,
  validateAction,
  translateJexi,
  ACTION_SPACE,
  ACTION_SPACE_VERSION,
  JEXI_PHASE29_SPACE,
  SCROLL_STEP,
  WAIT_DEFAULT_SECONDS,
  APPS,
  run,
  FIXTURES,
};

export {
  load,
  loadDiagnostics,
  validateTask,
  loadObservations,
  validateObservations,
  loadReal,
  createAdapter,
  observe,
  validateEvaluator,
  translateJexi,
  ACTION_SPACE,
  ACTION_SPACE_VERSION,
  JEXI_PHASE29_SPACE,
  SCROLL_STEP,
  WAIT_DEFAULT_SECONDS,
  APPS,
  FIXTURES,
};
export default osw;

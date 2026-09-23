/**
 * JEXI OS — benchmarks/webarena/index.js
 *
 * Public API (Phase 31 Scope 14 contract):
 *   wa.load({ split, fixturePath? })                  -> tasks[]
 *   wa.adapter({ mode, browser })                     -> { step(observation) -> { action, args, trace } }
 *   wa.observe(rawDom)                                -> { url, visibleText, focus, a11y }
 *   wa.verify(task, finalState)                       -> { pass, rules }
 *   wa.run({ fixture, agent, verify })                -> { perSite, overall, perTask[], ... }
 *
 * run() orchestrates: load -> resolve the fixture's sibling observations
 * (pre-recorded DOM snapshots) -> per task: fresh episode, replay every
 * snapshot through agent.step() (the injected adapter IS the agent),
 * evaluate the task's rule-based evaluator against the FINAL snapshot ->
 * report. The agent and verifier are INJECTED:
 * - sandbox (scope 14): wa.adapter(...) over a stub browser; verify =
 *   the rule-based default (or an equivalent injection);
 * - real run (scope 17): browser wraps the Phase 17 DOM arm + Phase 29
 *   visual arm against self-hosted WebArena sites; verify is the
 *   site-backed evaluator.
 *
 * No live browser, no Docker, no network outside the gated loader. The
 * adapter consumes Phase 17/29 READ-ONLY through injection; nothing here
 * imports or edits Phase 17 (ui/web/console/chat/**) or Phase 29
 * (computer/**) files.
 */

import path from 'node:path';
import {
  load,
  loadDiagnostics,
  validateTask,
  loadObservations,
  validateObservations,
  loadReal,
  SITES,
  FIXTURES,
} from './tasks.js';
import { createAdapter, validateAction, ACTION_SPACE, ACTION_SPACE_VERSION } from './adapter.js';
import { observe } from './observation.js';
import { verify as ruleVerify, validateEvaluator, evaluatorRules } from './verifier.js';
import { buildReport } from './report.js';

export async function run({ fixture, split = 'mini', agent, verify = ruleVerify, observationsPath } = {}) {
  if (!agent || typeof agent.step !== 'function') {
    const err = new Error(
      'wa.run: an injected agent with step(observation) is required ' +
      "(sandbox: wa.adapter({ mode, browser }); scope 17: the adapter over real Phase 17/29 arms)"
    );
    err.code = 'WA_AGENT_REQUIRED';
    throw err;
  }
  if (typeof verify !== 'function') {
    const err = new Error(
      'wa.run: verify must be a function (task, finalState) -> { pass } ' +
      '(default: the rule-based evaluator; scope 17: site-backed evaluator)'
    );
    err.code = 'WA_VERIFY_REQUIRED';
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
    if (typeof agent.reset === 'function') agent.reset(); // fresh episode per task
    const actions = [];
    let finalState = null;
    for (const snap of entry.snapshots) {
      const obs = observe(snap);
      finalState = obs;
      const move = await agent.step(obs, { task });
      actions.push({ action: move.action, args: move.args });
    }
    const verdict = await verify(task, finalState);
    evaluated.push({
      task_id: task.task_id,
      sites: [...task.sites],
      primarySite: task.sites[0] ?? '',
      stepsUsed: actions.length,
      passed: verdict.pass === true,
      evaluatorKinds: evaluatorRules(task.evaluator).map((r) => r.kind),
      actions,
      rules: verdict.rules ?? [],
    });
  }

  return buildReport({
    split,
    fixture: fixture ?? `bundled:${split}`,
    evaluated,
    rejected: diag.rejected,
    sitesOrder: SITES,
  });
}

export const wa = {
  load,
  loadDiagnostics,
  validateTask,
  loadObservations,
  validateObservations,
  loadReal,
  adapter: createAdapter,
  observe,
  verify: ruleVerify,
  validateEvaluator,
  validateAction,
  ACTION_SPACE,
  ACTION_SPACE_VERSION,
  SITES,
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
  ACTION_SPACE,
  ACTION_SPACE_VERSION,
  SITES,
  FIXTURES,
};
export default wa;

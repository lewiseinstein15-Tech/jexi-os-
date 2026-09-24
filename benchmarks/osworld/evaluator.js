/**
 * JEXI OS — benchmarks/osworld/evaluator.js
 *
 * osw.evaluate(task, finalState) -> { pass, rules }
 *
 * Default rule-based success evaluator (OSWorld style, binary). The REAL
 * OSWorld evaluators run inside the harness VM (vm_file, vm_command_line,
 * vm_json, ...); they are unreachable in the build-only sandbox. This module
 * is the deterministic sandbox default over the parsed observation shape —
 * the SAME shape the adapter and report see — and run({ evaluate }) accepts
 * an injected evaluator with the same (task, finalState) signature for the
 * scope-17 real run (VM-backed evaluators wrapped behind the same seam).
 *
 * Frozen rule kinds (sandbox-safe projections of the OSWorld families):
 *   { kind: 'app_focus', app }        finalState.appFocus === app
 *   { kind: 'cwd_match', pattern }    RegExp(pattern).test(finalState.cwd ?? '')
 *                                     (null cwd is matched against '' — a
 *                                     cwd rule on a shell-less state fails,
 *                                     it never throws)
 *   { kind: 'screen_size', width, height }  finalState.screenSize deep-equals
 *                                     { width, height } (null fails)
 * Composition: { all: [rule, ...] } — every rule must pass (AND).
 *
 * The evaluator spec is part of the task: a missing/malformed spec is a
 * task defect -> E_INVALID_TASK, validated at load time AND re-validated
 * at evaluate time (never silently treated as pass or fail).
 *
 * Deterministic: pure functions over the task + final state.
 */

import { observe } from './observation.js';

const RULE_KINDS = Object.freeze(['app_focus', 'cwd_match', 'screen_size']);

function invalidTask(reason, where) {
  const err = new Error(`E_INVALID_TASK — ${where}: ${reason}`);
  err.code = 'E_INVALID_TASK';
  err.reason = reason;
  return err;
}

function validateRule(rule, where) {
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
    throw invalidTask('evaluator rule must be an object', where);
  }
  if (typeof rule.kind !== 'string' || !RULE_KINDS.includes(rule.kind)) {
    throw invalidTask(
      `unknown evaluator kind ${JSON.stringify(rule.kind ?? null)} (known: ${RULE_KINDS.join(' | ')})`,
      where
    );
  }
  if (rule.kind === 'app_focus') {
    if (typeof rule.app !== 'string' || rule.app === '') {
      throw invalidTask('app_focus.app must be a non-empty string', where);
    }
  } else if (rule.kind === 'cwd_match') {
    if (typeof rule.pattern !== 'string' || rule.pattern === '') {
      throw invalidTask('cwd_match.pattern must be a non-empty string', where);
    }
    try {
      new RegExp(rule.pattern);
    } catch (e) {
      throw invalidTask(`cwd_match.pattern is not a valid RegExp: ${e.message}`, where);
    }
  } else if (rule.kind === 'screen_size') {
    if (!Number.isInteger(rule.width) || rule.width <= 0) {
      throw invalidTask('screen_size.width must be a positive integer', where);
    }
    if (!Number.isInteger(rule.height) || rule.height <= 0) {
      throw invalidTask('screen_size.height must be a positive integer', where);
    }
  }
  return true;
}

/** Validate an evaluator spec (single rule or { all: [...] }). Throws
 *  E_INVALID_TASK on any defect. */
export function validateEvaluator(evaluator, where = 'evaluator') {
  if (!evaluator || typeof evaluator !== 'object' || Array.isArray(evaluator)) {
    throw invalidTask('missing evaluator (expected a rule object or { all: [rules] })', where);
  }
  if (Array.isArray(evaluator.all)) {
    if (evaluator.all.length === 0) {
      throw invalidTask('evaluator.all must be a non-empty array of rules', where);
    }
    evaluator.all.forEach((r, i) => validateRule(r, `${where}.all[${i}]`));
  } else {
    validateRule(evaluator, where);
  }
  return true;
}

/** Flatten an (already validated) evaluator spec to its rule list. */
export function evaluatorRules(evaluator) {
  return Array.isArray(evaluator.all) ? evaluator.all : [evaluator];
}

function evalRule(rule, state) {
  if (rule.kind === 'app_focus') {
    return state.appFocus === rule.app;
  }
  if (rule.kind === 'cwd_match') {
    return new RegExp(rule.pattern).test(state.cwd ?? '');
  }
  // screen_size
  return (
    state.screenSize !== null &&
    state.screenSize.width === rule.width &&
    state.screenSize.height === rule.height
  );
}

/**
 * Evaluate the task's rule-based evaluator against the final parsed
 * observation. Binary result; per-rule details included for the report.
 */
export function evaluate(task, finalState) {
  const where = `task ${task?.task_id ?? '(unnamed)'}`;
  validateEvaluator(task?.evaluator, where); // throws E_INVALID_TASK
  const state = observe(finalState); // throws E_INVALID_OBSERVATION
  const rules = evaluatorRules(task.evaluator);
  const results = rules.map((rule) => ({ kind: rule.kind, pass: evalRule(rule, state) }));
  return { pass: results.every((r) => r.pass), rules: results };
}

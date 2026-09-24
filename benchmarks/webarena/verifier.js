/**
 * JEXI OS — benchmarks/webarena/verifier.js
 *
 * wa.verify(task, finalState) -> { pass, rules }
 *
 * Default rule-based success evaluator (WebArena style, binary):
 *   { kind: 'url_match', pattern }          finalState.url matches RegExp(pattern)
 *   { kind: 'string_match', text }          finalState.visibleText includes text
 *                                           (case-sensitive substring)
 *   { kind: 'a11y_contains', name, role? }  some a11y node has this name
 *                                           (exact; role must match when given)
 * Composition: { all: [rule, ...] } — every rule must pass (AND).
 *
 * The evaluator spec is part of the task: a missing/malformed spec is a
 * task defect -> E_INVALID_TASK, validated at load time AND re-validated
 * at verify time (never silently treated as pass or fail).
 *
 * Pluggability: run({ verify }) accepts an injected verifier with the
 * same (task, finalState) signature for the scope-17 real run, where the
 * site-backed evaluator replaces these fixture rules. This module is the
 * deterministic default.
 *
 * Deterministic: pure functions over the task + final state.
 */

import { observe } from './observation.js';

const RULE_KINDS = Object.freeze(['url_match', 'string_match', 'a11y_contains']);

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
  if (rule.kind === 'url_match') {
    if (typeof rule.pattern !== 'string' || rule.pattern === '') {
      throw invalidTask('url_match.pattern must be a non-empty string', where);
    }
    try {
      new RegExp(rule.pattern);
    } catch (e) {
      throw invalidTask(`url_match.pattern is not a valid RegExp: ${e.message}`, where);
    }
  } else if (rule.kind === 'string_match') {
    if (typeof rule.text !== 'string' || rule.text === '') {
      throw invalidTask('string_match.text must be a non-empty string', where);
    }
  } else if (rule.kind === 'a11y_contains') {
    if (typeof rule.name !== 'string' || rule.name === '') {
      throw invalidTask('a11y_contains.name must be a non-empty string', where);
    }
    if (rule.role !== undefined && (typeof rule.role !== 'string' || rule.role === '')) {
      throw invalidTask('a11y_contains.role must be a non-empty string when present', where);
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
  if (rule.kind === 'url_match') {
    return new RegExp(rule.pattern).test(state.url);
  }
  if (rule.kind === 'string_match') {
    return state.visibleText.includes(rule.text);
  }
  // a11y_contains
  return state.a11y.some(
    (n) => n.name === rule.name && (rule.role === undefined || n.role === rule.role)
  );
}

/**
 * Evaluate the task's rule-based evaluator against the final parsed
 * observation. Binary result; per-rule details included for the report.
 */
export function verify(task, finalState) {
  const where = `task ${task?.task_id ?? '(unnamed)'}`;
  validateEvaluator(task?.evaluator, where); // throws E_INVALID_TASK
  const state = observe(finalState); // throws E_INVALID_OBSERVATION
  const rules = evaluatorRules(task.evaluator);
  const results = rules.map((rule) => ({ kind: rule.kind, pass: evalRule(rule, state) }));
  return { pass: results.every((r) => r.pass), rules: results };
}

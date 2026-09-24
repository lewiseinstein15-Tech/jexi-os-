// prompt/testing/framework.js
// Phase 25 — Scope K: the TDD harness for prompts.
//
// testing.run(testId) -> { passed, failures, durationMs }
//
// - Runs the test's assertions IN ORDER against the test's prompt string
//   (pure string work — RULE 7: no LLM calls, the framework runs on the
//   built prompt string only).
// - failures: every failed assertion, each naming itself (index + kind)
//   and carrying expected vs actual (RULE 5 — no swallowing).
// - passed: true iff zero failures (RULE 4: deterministic — same spec and
//   same subject produce the same verdict every time; only durationMs, a
//   wall-clock measurement, varies, and comparison probes mask it exactly
//   like the timestamps elsewhere in Phase 25).
//
// Additive (used by the probe for "the SAME test against two prompts"):
//   testing.run(testId, { prompt }) — subject override; the catalog spec
//   stays untouched, only this run's subject differs.

import { get as getTest } from './registry.js';
import { runAssertion, TESTING_CODES } from './assertions.js';

export { TESTING_CODES };

/**
 * testing.run(testId, opts?) ->
 *   { testId, passed, failures, durationMs }
 * opts = { prompt?: string }  (optional subject override for this run)
 */
export function run(testId, opts = {}) {
  if (typeof testId !== 'string' || testId.trim() === '') {
    const err = new Error('run requires a testId string');
    err.code = TESTING_CODES.NO_SUCH_TEST;
    throw err;
  }
  const spec = getTest(testId);
  if (!spec) {
    const err = new Error(`no such test: ${testId}`);
    err.code = TESTING_CODES.NO_SUCH_TEST;
    throw err;
  }
  let subject = spec.prompt;
  if (opts && opts.prompt !== undefined) {
    if (typeof opts.prompt !== 'string') {
      const err = new Error('opts.prompt override must be a string');
      err.code = TESTING_CODES.INVALID_RUN_OPTS;
      throw err;
    }
    subject = opts.prompt;
  }
  const t0 = Date.now();
  const results = spec.assertions.map((a, i) => runAssertion(a, subject, i));
  const durationMs = Date.now() - t0;
  const failures = results.filter((r) => !r.passed);
  return {
    testId: spec.testId ?? testId,
    passed: failures.length === 0,
    failures,
    durationMs,
  };
}

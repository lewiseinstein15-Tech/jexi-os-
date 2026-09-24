/**
 * JEXI OS — benchmarks/swebench-pro/evaluate.js
 *
 * swepro.evaluate(instance, { testRunner }) ->
 *   { failToPass: bool, passToPass: bool, resolved: bool, tests: [...] }
 *
 * FAIL_TO_PASS + PASS_TO_PASS check runner with an INJECTED testRunner:
 * - sandbox (scope 12): a stub supplied by the caller that returns
 *   pre-declared per-instance results;
 * - real run (scope 17): the harness runner inside the per-instance
 *   Docker environment.
 *
 * The testRunner receives { instance_id, test, kind } and returns a
 * boolean or { pass: bool }. resolved = failToPass AND passToPass —
 * binary per instance, no partial credit. Empty test lists are vacuously
 * true (the fixture's valid instances carry non-empty lists). The
 * instance is re-validated here: malformed instances throw
 * E_INVALID_INSTANCE.
 *
 * Deterministic: iteration order follows the instance's own arrays.
 */

import { validateInstance } from './dataset.js';

export async function evaluate(instance, { testRunner } = {}) {
  const where = `instance ${instance?.instance_id ?? '(unnamed)'}`;
  validateInstance(instance, where); // throws E_INVALID_INSTANCE

  if (typeof testRunner !== 'function') {
    const err = new Error(
      'swepro.evaluate: an injected testRunner function is required ' +
      '(sandbox: stub with pre-declared results; scope 17: real harness runner)'
    );
    err.code = 'SWEBENCH_RUNNER_REQUIRED';
    throw err;
  }

  const runKind = async (tests, kind) => {
    const results = [];
    for (const test of tests) {
      const out = await testRunner({ instance_id: instance.instance_id, test, kind });
      const pass = typeof out === 'boolean' ? out : out?.pass === true;
      results.push({ kind, test, pass });
    }
    return { all: results.every((r) => r.pass), results };
  };

  const ftp = await runKind(instance.FAIL_TO_PASS, 'FAIL_TO_PASS');
  const ptp = await runKind(instance.PASS_TO_PASS, 'PASS_TO_PASS');

  return {
    failToPass: ftp.all,
    passToPass: ptp.all,
    resolved: ftp.all && ptp.all,
    tests: [...ftp.results, ...ptp.results],
  };
}

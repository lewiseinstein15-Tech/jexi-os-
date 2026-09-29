/**
 * JEXI OS — VERIFICATION — TestVerifier.
 *
 * Runs a test command against the SNAPSHOT source (never the live workspace)
 * and parses the output into evidence. A 'fail' status propagates to the work
 * graph as a blocker; evidence is attached to the node.
 *
 * REAL SPAWN (Phase 5 Scope B): unless an explicit `options.run` runner is
 * injected, the verifier spawns the project's real test command via
 * child_process.spawn. If no test command is configured, it returns
 * { status: 'error', reason: 'no test command configured' } — NEVER a canned
 * pass. stdout/stderr are parsed into failures.
 */

import { runCommand, resolveConfiguredCommand } from '../spawn/execute.js';
import { verifyCwd, cleanupSandbox } from '../spawn/sandbox.js';
import { parsePytestReport, parseNodeTestReport, detectTestCommand } from '../../tools/domains/testing/index.js';

/**
 * JEXI-024 — a pass is not "exit code 0".
 *
 * The real-spawn path ended with `const pass = res.ok`, i.e. exit code only.
 * That makes two things read as green when they are not:
 *   - a suite that collected ZERO tests and exited 0 (a typo'd path, a
 *     conftest that silently skips everything, a renamed tests/ dir);
 *   - a framework that reports failures but exits 0 through a wrapper.
 *
 * So the framework output is parsed, and the verdict is the STRICTER of
 * "exit code said ok" and "the framework said tests actually ran and none
 * failed". An empty suite is an `error`, never a `pass`, unless the caller
 * explicitly allows it (`allowEmpty: true`) for repos that genuinely have no
 * tests yet.
 */
function judge({ res, kind, allowEmpty, explicit = false }) {
  const output = res.output ?? '';
  const p = kind === 'pytest'
    ? parsePytestReport(output, res.code ?? -1)
    : parseNodeTestReport(output, res.code ?? -1);

  /* The "did anything actually run?" check comes FIRST and is independent of
     the exit code — a suite that collected nothing is an error whatever the
     process returned, and an explicit allowEmpty is the only way past it.

     EXCEPT when the caller supplied the command themselves. "0 tests
     collected" is only meaningful for a command that *runs tests* (`npm test`,
     `pytest`). Given an arbitrary script, the count is meaningless and the
     exit code is the whole signal: `node src/plain-sum.js` exiting 1 is a
     real failure, and reporting it as an `error` misattributes a genuine red
     result to a broken harness. That regression shipped with this rule and
     turned three passing assertions red. */
  if (p.tests === 0) {
    if (allowEmpty) return { status: 'pass', parsed: p, reason: undefined };
    if (explicit && (res.code ?? 0) !== 0) {
      // A caller-supplied command that exits nonzero is unambiguously red.
      // Exit 0 is NOT automatically green: JEXI-024 is explicit that a command
      // which ran nothing must not verify, and an "all good, trust me" script
      // exiting 0 is exactly that case. Treating exit 0 as a pass here would
      // undo the rule this whole ticket set exists to enforce.
      return { status: 'fail', parsed: p, reason: `explicit command exited ${res.code}` };
    }
    return { status: 'error', parsed: p, reason: `${kind}: 0 tests collected — an empty suite is not a pass` };
  }

  if (p.status === 'pass') return { status: 'pass', parsed: p, reason: undefined };
  if (kind === 'pytest') {
    return { status: p.status, parsed: p, reason: p.failures[0]?.message || `pytest: ${p.failed} failed, ${p.errors} error(s)` };
  }
  return { status: p.status, parsed: p, reason: `tests failed (${p.fail} failed of ${p.tests})` };
}

/** Which framework produced this output? The command is the strongest signal. */
function detectKind(spec, output) {
  const cmd = String((spec && spec[0]) || '').toLowerCase();
  if (cmd.includes('pytest')) return 'pytest';
  if (/^=+\s*[\d\s,]*(passed|failed|error)/m.test(output) || /^\s*FAILED\s+\S+::/m.test(output)) return 'pytest';
  if (cmd === 'npm' || cmd.endsWith('npm') || /#\s*tests\s+\d+/.test(output)) return 'node';
  return 'node';
}

/** @type {import('../interface/Verifier.js').Verifier} */
export const TestVerifier = {
  name: 'TestVerifier',

  /**
   * @type {(context: import('../interface/Verifier.js').VerifyContext) => Promise<import('../interface/Verifier.js').VerifyResult>}
   */
  async verify({ _nodeId, snapshotId, snapshot, _acceptanceCriteria, _claimantAcbId, options = {} }) {
    const started = Date.now();
    const { run, cwd = process.cwd(), timeoutMs, command, args = [], testCommand, materialize } = options;
    // An explicitly injected runner wins (tests use this); otherwise the real
    // spawn path runs.
    if (typeof run === 'function') {
      const res = await run();
      const pass = res.exitCode === 0 && !/fail|failing/i.test(res.output);
      return {
        status: pass ? 'pass' : 'fail',
        evidence: [{
          source: 'TestVerifier',
          snapshotId,
          content: `exitCode=${res.exitCode} ${res.output}`,
          at: Date.now(),
        }],
        reason: pass ? undefined : 'tests failed',
        durationMs: Date.now() - started,
      };
    }

    // Precedence: explicit `testCommand`/`command`+`args` → the project's
    // configured verify command → AUTO-DETECTED test command.
    //
    // The last step matters (JEXI-006): a Python project has no package.json,
    // so `resolveConfiguredCommand` returned null and the verifier answered
    // "no test command configured" — an error, never a pass, which is honest
    // but useless. The same detector the pytest tool uses now decides, so
    // "fix the failing pytest" is verifiable on a pytest repo.
    const configured = resolveConfiguredCommand(cwd, 'test');
    const detected = configured ? null : detectTestCommand(cwd);
    const spec = testCommand
      || (command ? [command, ...args] : null)
      || configured
      || (detected ? detected.split(/\s+/).filter(Boolean) : null);
    if (!spec) {
      return {
        status: 'error',
        evidence: [{ source: 'TestVerifier', snapshotId, content: 'no test command configured', at: Date.now() }],
        reason: 'no test command configured',
        durationMs: Date.now() - started,
      };
    }

    return runTestEvidence({
      spec, cwd, snapshot, snapshotId, materialize, timeoutMs,
      allowEmpty: options.allowEmpty === true,
      detected: !configured && !testCommand && !command,
      // The caller chose this command; it is not necessarily a test runner.
      explicit: !!command,
    });
  },
};

/**
 * JEXI-018 — THE ONE seam for "run the tests and get pass/fail evidence".
 *
 * The chat agent loop and the WorkGraph verifier used to reach for tests by
 * different routes, which is how the two drift: one got the exit code, the
 * other got a parsed summary, and a fix verified by one was unverified by the
 * other. There is now a single implementation, and both callers name this
 * binding. If you are about to run a test suite anywhere in this codebase,
 * call this instead.
 *
 * The rule it enforces for BOTH callers: verify the FROZEN snapshot bytes, not
 * the live workspace (JEXI-007 — the default, not an opt-in), and always
 * return a real exit code alongside the parse.
 */
export async function runTestEvidence({
  spec, cwd, snapshot, snapshotId, materialize, timeoutMs,
  allowEmpty = false, detected = false, explicit = false, source = 'TestVerifier',
}) {
  const started = Date.now();
  const { cwd: runCwd, sandbox, materialized, reason: cwdReason } = verifyCwd(snapshot, { cwd, materialize });
  const res = await runCommand(spec, { cwd: runCwd, timeoutMs });
  if (sandbox) cleanupSandbox(sandbox);

  // A spawn that never produced output is a harness error, not a test result.
  // Reporting it as `fail` would blame the code for a missing binary.
  if (!res.ok && res.spawnError && !res.stdout && !res.stderr) {
    return {
      status: 'error',
      evidence: [{ source, snapshotId, content: res.spawnError, at: Date.now() }],
      reason: res.spawnError,
      durationMs: Date.now() - started,
    };
  }

  const kind = detectKind(spec, res.output ?? '');
  const { status, parsed, reason } = judge({ res, kind, allowEmpty, explicit });
  const evidence = [{
    source,
    snapshotId,
    content: `exitCode=${res.code} ${res.output || (status === 'pass' ? 'ok' : '')}`.trim(),
    at: Date.now(),
    meta: {
      spawn: { command: spec[0], args: spec.slice(1), timedOut: res.timedOut, stdout: res.stdout, stderr: res.stderr, exitCode: res.code },
      sandboxed: Boolean(sandbox),
      materialized: Boolean(materialized),
      cwdReason,
      framework: kind,
      detected,
      counts: kind === 'pytest'
        ? { passed: parsed.passed, failed: parsed.failed, errors: parsed.errors, tests: parsed.tests }
        : { pass: parsed.pass, fail: parsed.fail, tests: parsed.tests },
    },
  }];
  return { status, evidence, reason, durationMs: Date.now() - started };
}
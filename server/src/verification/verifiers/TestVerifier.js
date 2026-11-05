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

import fs from 'node:fs';
import path from 'node:path';

import { runCommand, resolveConfiguredCommand } from '../spawn/execute.js';
import { verifyCwd, cleanupSandbox } from '../spawn/sandbox.js';
import { parsePytestReport, parseNodeTestReport, detectTestCommand } from '../../tools/domains/testing/index.js';

/**
 * M21 — is this an EXEC-STYLE test file that pytest cannot check?
 *
 * The HumanEval sandbox ships `test_<entry>.py` as a bare script: it defines
 * `check(candidate)` and calls `check(<entry>)` with NO import of the module
 * under test. `pytest -q` imports that file, `check` runs, and `<entry>` is not
 * defined — so every task reports
 *     NameError: name '<entry>' is not defined
 * even when `solution.py` defines it correctly. The official grader `exec`s the
 * solution into the test namespace first, which is why the grader PASSES the
 * same bytes. The auto-detected runner therefore cannot check this edit at all,
 * and injecting that NameError as a failure sent the model into a rewrite loop.
 *
 * Narrow on purpose: EVERY failure must be a bare `NameError: name '…'`
 * (pytest's `-q` FAILED line truncates the message, so the trailing "is not
 * defined" may be cut), and the test file must not import anything. A real test
 * file imports its module, so a genuine NameError inside it still fails.
 */
export function looksLikeExecStylePytest(parsed, root) {
  const failures = parsed?.failures ?? [];
  if (!failures.length) return false;
  const allNameErrors = failures.every((f) => /NameError:\s*name\s*'/.test(String(f.message ?? '')));
  if (!allNameErrors) return false;
  try {
    const files = fs.readdirSync(root).filter((f) => /^test_.+\.py$/.test(f));
    if (!files.length) return false;
    return files.every((f) => !/^\s*(?:import|from)\s+\w/m.test(fs.readFileSync(path.join(root, f), 'utf8')));
  } catch { return false; }
}

/**
 * M22 — THE EXEC-STYLE RUNNER.
 *
 * `looksLikeExecStylePytest` above correctly says `pytest -q` cannot check the
 * HumanEval sandbox shape. But that shape IS checkable — the official grader
 * does it: exec `solution.py` into a namespace, then exec the test file, whose
 * last line calls `check(<entry>)`. If the candidate is wrong the call raises
 * and the process exits nonzero. M21 stopped at "unverifiable", so a Python
 * task never produced a real pass/fail signal and a test-driven repair had
 * nothing to converge on.
 *
 * This returns the real spec that reproduces the official grader, or null when
 * the project is not that shape. Narrow on purpose:
 *   - a flat directory (the sandbox shape), with a `solution.py`;
 *   - at least one `test_*.py` that imports nothing (an exec-style script);
 *   - the test file calls `check(...)` at module level, so exec runs it.
 * A normal pytest repo has importing test files, so it is untouched.
 *
 * @param {string} root
 * @returns {string[]|null} [python, '-c', script, solutionName, testName] or null
 */
export function execStyleRunner(root) {
  const script = [
    'import sys, traceback',
    'ns = {}',
    'try:',
    '    exec(compile(open(sys.argv[1], encoding="utf-8").read(), sys.argv[1], "exec"), ns)',
    '    exec(compile(open(sys.argv[2], encoding="utf-8").read(), sys.argv[2], "exec"), ns)',
    'except Exception:',
    '    traceback.print_exc()',
    '    sys.exit(1)',
    'sys.exit(0)',
  ].join('\n');
  try {
    const solution = path.join(root, 'solution.py');
    if (!fs.existsSync(solution)) return null;
    const tests = fs.readdirSync(root).filter((f) => /^test_.+\.py$/.test(f));
    if (tests.length !== 1) return null;
    const testPath = path.join(root, tests[0]);
    const src = fs.readFileSync(testPath, 'utf8');
    if (/^\s*(?:import|from)\s+\w/m.test(src)) return null;   // a real pytest file imports its module
    /* The official grader's test file calls check() at MODULE level (column 0),
       so `exec` runs it. A check() call nested inside a function would never
       run under exec and would false-pass, so require column 0. */
    if (!/^check\s*\(/m.test(src)) return null;
    /* Pass the names RELATIVE to the run cwd, not absolute paths under `root`.
       The spawn layer may run the child in a materialized snapshot tempdir
       rather than `root`; relative names resolve against whatever cwd the child
       actually gets, so the spec stays correct under both. */
    return [process.env.PYTHON || 'python3', '-c', script, 'solution.py', tests[0]];
  } catch { return null; }
}

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
function judge({ res, kind, allowEmpty, explicit = false, detected = false, cwd = process.cwd() }) {
  const output = res.output ?? '';
  const p = kind === 'pytest'
    ? parsePytestReport(output, res.code ?? -1)
    : parseNodeTestReport(output, res.code ?? -1);

  /* M21 — the exec-style pytest false failure (see looksLikeExecStylePytest).
     The auto-detected runner reports a NameError the model did NOT cause, so
     the edit is `unverifiable` rather than `fail`. Explicit/configured
     commands stay strict: the caller chose them. */
  if (kind === 'pytest' && !explicit && looksLikeExecStylePytest(p, cwd)) {
    return { status: 'unverifiable', parsed: p, reason: 'pytest cannot check an exec-style test file (the test calls the entry point without importing it) — this edit is unverifiable by the auto-detected runner' };
  }

  /* M21 — an AUTO-DETECTED runner that collects nothing did not FAIL; it just
     does not match this project's test shape. `pytest -q` on a sandbox whose
     test file is a plain script (HumanEval's `check()` idiom) exits 5 with
     "0 tests collected": reporting that as an `error` injected a bogus "fix
     this" failure and drove the model to rewrite the same file to the
     iteration cap. Only for DETECTED commands — an explicit/configured command
     that runs nothing stays an error (JEXI-024), because the caller chose it. */
  if (p.tests === 0 && detected && !explicit && !allowEmpty) {
    return { status: 'inapplicable', parsed: p, reason: `${kind}: no tests matched this project's shape — nothing to verify` };
  }

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
    /* M22 — EXEC-STYLE FIRST. When the project is the HumanEval sandbox shape,
       `pytest -q` cannot check it (M21 proved that) but the OFFICIAL exec
       pattern can. Prefer that runner over the detected `pytest -q`, so a
       Python task gets a real pass/fail signal instead of `unverifiable`. An
       explicit caller-supplied command still wins. */
    const execSpec = (testCommand || command) ? null : execStyleRunner(cwd);
    const spec = testCommand
      || (command ? [command, ...args] : null)
      || execSpec
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
      detected: !configured && !testCommand && !command && !execSpec,
      // The caller chose this command; it is not necessarily a test runner.
      explicit: !!command,
      // An exec-style runner is a real script, not a framework: exit code is
      // the whole signal, so a nonzero exit is a genuine failure and a zero
      // exit (check() returned without raising) is a genuine pass.
      script: Boolean(execSpec),
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
  allowEmpty = false, detected = false, explicit = false, script = false, source = 'TestVerifier',
}) {
  const started = Date.now();
  const { cwd: runCwd, sandbox, materialized, reason: cwdReason } = verifyCwd(snapshot, { cwd, materialize });
  let res = await runCommand(spec, { cwd: runCwd, timeoutMs });
  /* M21 — `pytest` is frequently installed as a MODULE with no console script
     on the spawned PATH (pip drops the shim in ~/.local/bin, which the child
     PATH often lacks). spawn then fails ENOENT and the layer reports an error,
     which the loop injects to the model as a failure. Retry ONCE as
     `python3 -m pytest` — the form that resolves wherever the module lives. */
  if (!res.ok && res.spawnError && /ENOENT/.test(res.spawnError) && spec[0] === 'pytest') {
    res = await runCommand([process.env.PYTHON || 'python3', '-m', 'pytest', ...spec.slice(1)], { cwd: runCwd, timeoutMs });
  }
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
  /* M22 — an exec-style runner is a plain script, so its exit code is the whole
     verdict: nonzero means check() raised, zero means it returned clean. It is
     judged like an explicit command, never by the framework output parser. */
  const { status, parsed, reason } = script
    ? (res.ok
      ? { status: 'pass', parsed: { pass: 1, fail: 0, tests: 1 }, reason: undefined }
      : { status: 'fail', parsed: { pass: 0, fail: 1, tests: 1 }, reason: (res.output || '').trim().split('\n').slice(-6).join('\n') || `exec-style runner exited ${res.code}` })
    : judge({ res, kind, allowEmpty, explicit, detected, cwd: runCwd });
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
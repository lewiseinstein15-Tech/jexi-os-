/**
 * JEXI OS — tools — testing domain.
 *
 * The headline path of this system is "fix the failing pytest test", so
 * Node-only test running (JEXI-006) made the primary use case unreachable:
 * `detectTestCommand` read package.json and nothing else, and `test_run`
 * shelled out to `node --test`. There was no first-class pytest path at all.
 *
 * What is here now:
 *   test_run    — auto-detects the project (pytest vs node) and dispatches
 *   pytest_run  — explicit pytest, with structured pass/fail/error counts and
 *                 a per-failure list the agent can act on
 *   test_coverage
 *
 * HONESTY RULES (JEXI-024): a run is `pass` only when the framework says so
 * AND at least one test actually executed. "exit code 0 with 0 tests" is not a
 * pass, it is an error — a suite that silently collects nothing is the exact
 * failure mode a verifier is supposed to catch.
 */

import { defineTool } from '../../interface/ToolDefinition.js';
import { registerToolBatch } from '../../registry/ToolRegistry.js';
import { runNativeCommand } from '../../../services/NativeCommand.js';
import { sessionSandbox } from '../../../services/Sandbox.js'; // JEXI-001 — a test runner executes arbitrary project code
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** What kind of test project is this? */
export function detectProjectKind(root = process.cwd()) {
  const has = (p) => fs.existsSync(path.join(root, p));
  const cfg = (p) => { try { return fs.readFileSync(path.join(root, p), 'utf8'); } catch { return ''; } };

  const pyproject = cfg('pyproject.toml');
  const pytestIni = cfg('pytest.ini');
  const setupPy = has('setup.py') || has('setup.cfg');
  const pyMarkers = /\[tool\.pytest|\[pytest\]|pytest/.test(pyproject + pytestIni + cfg('tox.ini'));
  const pySources = fs.existsSync(path.join(root, 'tests')) &&
    fs.readdirSync(path.join(root, 'tests')).some((f) => f.startsWith('test_') && f.endsWith('.py'));

  if (pyMarkers || pySources || setupPy) return 'pytest';

  try {
    const pkg = JSON.parse(cfg('package.json') || '{}');
    if (pkg.scripts && pkg.scripts.test) return 'node';
  } catch { /* no package.json */ }
  if (has('package.json')) return 'node';
  if (has('tests')) return 'pytest';   // a bare `tests/` with no marker still smells Python
  return null;
}

/** Detect the test command for a project root. Kept for API compatibility. */
export function detectTestCommand(root = process.cwd()) {
  const kind = detectProjectKind(root);
  if (kind === 'pytest') return 'pytest -q';
  if (kind === 'node') {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
      if (pkg.scripts && pkg.scripts.test) return 'npm test';
    } catch { /* fall through */ }
    return 'node --test';
  }
  return null;
}

function num(output, res) {
  for (const re of res) {
    const m = output.match(re);
    if (m) { const v = Number(m[1]); if (Number.isFinite(v)) return v; }
  }
  return 0;
}

export function parseNodeTestReport(output, exitCode) {
  // node --test ships TWO reporter shapes:
  //   TAP :  "# pass 3"  / "# fail 0"  / "# tests 3"     (tap reporter)
  //   spec:  "ℹ pass 3"  / "ℹ fail 0"  / "ℹ tests 3"     (default spec reporter)
  const pass = num(output, [/#\s*pass (\d+)/, /[ℹ]\s*pass (\d+)/, /\bpass (\d+)/]);
  const fail = num(output, [/#\s*fail (\d+)/, /[ℹ]\s*fail(?:ed)? (\d+)/, /\bfail(?:ed)? (\d+)/]);
  const skip = num(output, [/#\s*skipped? (\d+)/, /[ℹ]\s*(?:skip(?:ped)?) (\d+)/]);
  const tests = num(output, [/#\s*tests (\d+)/, /[ℹ]\s*tests (\d+)/]) || (pass + fail);
  const hasFailureEvidence = /failing tests|✖/.test(output);
  // JEXI-024: exit 0 with zero tests is NOT a pass.
  let status;
  if (fail > 0 || exitCode !== 0) status = 'fail';
  else if (tests > 0 || pass > 0) status = 'pass';
  else status = hasFailureEvidence ? 'fail' : 'error';
  return { status, exitCode, pass, fail, skip, tests };
}

/**
 * Parse pytest output into structured evidence.
 *
 * Covers the shapes pytest actually emits across versions:
 *   "3 passed, 1 failed, 2 warnings in 0.12s"      (summary line, -q)
 *   "= 2 failed, 5 passed, 1 error in 1.03s ="     (summary, default)
 *   "FAILED tests/test_x.py::test_y - assert 1 == 2"
 *   "ERROR tests/test_x.py::test_z"
 * plus the "no tests ran" / collection-error cases.
 */
export function parsePytestReport(output, exitCode) {
  const summary = (output.match(/^(?:=+\s*)?([\d\s,]*\b(?:passed|failed|error|errors|skipped|xfailed|xpassed|warnings?)\b[^\n=]*)(?:=+)?$/m) || ['', ''])[1];
  const passed = num(summary || output, [/\b(\d+)\s+passed\b/]);
  const failed = num(summary || output, [/\b(\d+)\s+failed\b/]);
  const errors = num(summary || output, [/\b(\d+)\s+errors?\b/]);
  const skipped = num(summary || output, [/\b(\d+)\s+skipped\b/]);
  const xfailed = num(summary || output, [/\b(\d+)\s+xfailed\b/]);
  const warnings = num(summary || output, [/\b(\d+)\s+warnings?\b/]);
  const collectedNone = /(?:no tests ran|no tests collected)/i.test(output);

  // Per-failure list: the lines the agent needs to know WHAT to fix.
  const failures = [];
  for (const line of output.split('\n')) {
    let m = /^FAILED\s+(\S+?)(?:\s+-\s+(.*))?$/.exec(line);
    if (m) { failures.push({ kind: 'failed', test: m[1], message: (m[2] || '').trim() }); continue; }
    m = /^ERROR\s+(\S+?)(?:\s+-\s+(.*))?$/.exec(line);
    if (m) { failures.push({ kind: 'error', test: m[1], message: (m[2] || '').trim() }); }
  }

  // A traceback tail: the assertion the ticket says must never be truncated away.
  const assertionLines = output.split('\n')
    .filter((l) => /^\s*(E\s+)?(assert|AssertionError|.*Error:)/.test(l))
    .map((l) => l.trim()).slice(0, 25);

  const total = passed + failed + errors;
  let status;
  if (failed > 0 || errors > 0) status = 'fail';
  else if (/^ERROR|UsageError|INTERNALERROR/i.test(output.trim()) && exitCode !== 0) status = 'error';
  else if (exitCode !== 0) status = errors > 0 || /error/i.test(summary) ? 'fail' : 'error';
  // JEXI-024: collected nothing is never a pass, whatever the exit code says.
  else if (collectedNone || total === 0) status = 'error';
  else status = 'pass';

  return {
    status, exitCode,
    passed, failed, errors, skipped, xfailed, warnings,
    tests: total, failures, assertionLines,
  };
}

/** Keep the head AND the tail of long output: tracebacks live at the end. */
function evidenceOutput(output, maxChars = 8000) {
  const s = String(output ?? '');
  if (s.length <= maxChars) return s;
  const head = s.slice(0, Math.floor(maxChars * 0.35));
  const tail = s.slice(-Math.floor(maxChars * 0.65));
  return `${head}\n\n…[${s.length - maxChars} chars elided — failure detail is in the tail below]…\n\n${tail}`;
}

export function registerTestingTools({ useSandbox = true } = {}) {
  const defs = [
    defineTool({
      name: 'test_run', description: 'Run the project test suite (auto-detects pytest or node) and return real pass/fail counts.',
      riskLevel: 'medium', runtimeRing: 1,
      parameters: { type: 'object', properties: { file: { type: 'string' } }, required: [] },
      sideEffects: ['test'], failureTypes: ['tool_error'], idempotent: false,
    }),
    defineTool({
      name: 'pytest_run', description: 'Run pytest and return structured evidence: passed/failed/error counts plus the failing test ids and assertion lines.',
      riskLevel: 'medium', runtimeRing: 1,
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' }, args: { type: 'array', items: { type: 'string' } }, timeoutMs: { type: 'integer' } },
        required: [],
      },
      sideEffects: ['test'], failureTypes: ['tool_error'], idempotent: false,
    }),
    defineTool({
      name: 'test_coverage', description: 'Run tests with coverage and return the coverage report.', riskLevel: 'medium', runtimeRing: 1,
      parameters: { type: 'object', properties: { file: { type: 'string' } }, required: [] },
      sideEffects: ['test'], failureTypes: ['tool_error'], idempotent: false,
    }),
  ];
  const unreg = registerToolBatch(defs);

  /* A test run executes whatever code the project ships. That is arbitrary
     code execution, so it goes through the same session sandbox as the
     terminal domain (JEXI-001) rather than straight onto the host. */
  const pycacheDirs = [];
  const exec = async (argv, { root, timeoutMs, maxOutputChars = 60000 }) => {
    /* PYTHONPYCACHEPREFIX — why this is not optional.
       CPython decides a .pyc is fresh by comparing the SOURCE MTIME, at
       one-second granularity, to the timestamp baked into the .pyc. Edit a
       file and re-run the suite inside the same second and Python reuses the
       previous bytecode — the module under test silently keeps its OLD body.

       Observed here, reproducibly: plant a failing assertion, run the suite
       (fails correctly), apply the fix, run again — and the "before" run of
       the NEXT cycle reported `pass` on the still-broken source. A test
       runner that can report a false green is worse than no runner at all,
       because everything downstream trusts it.

       Pointing the cache at a fresh directory per run means bytecode is
       always compiled from the bytes currently on disk, and the project's own
       __pycache__ tree is never consulted. */
    const env = {};
    if (argv[0] === 'pytest' || argv.some((a) => a.includes('python'))) {
      const prefix = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-pycache-'));
      pycacheDirs.push(prefix);
      env.PYTHONPYCACHEPREFIX = prefix;
      env.PYTHONDONTWRITEBYTECODE = '1';
    }
    const cleanup = () => { for (const d of pycacheDirs.splice(0)) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* gone */ } } };

    if (!useSandbox) {
      const res = await runNativeCommand(argv[0], argv.slice(1), { cwd: root, timeoutMs, maxOutputChars, env });
      cleanup();
      return res;
    }
    const sandbox = sessionSandbox({ root });
    const res = await sandbox.run(argv, { timeoutMs, cwd: '/workspace', maxOutputChars, env });
    cleanup();
    return { ...res, output: res.output ?? '', code: res.code ?? -1, sandbox: { backend: res.backend, degraded: res.degraded } };
  };

  const runPytest = async (root, { path: target, args = [], timeoutMs = 120000 } = {}) => {
    const argv = ['-q', '--no-header', '-rfE', ...(Array.isArray(args) ? args : [])];
    if (target) argv.push(String(target));
    const res = await exec(['pytest', ...argv], { root, timeoutMs });
    const parsed = parsePytestReport(res.output ?? '', res.code ?? -1);
    return {
      framework: 'pytest',
      ...parsed,
      ok: parsed.status === 'pass',
      command: `pytest ${argv.join(' ')}`,
      root,
      output: evidenceOutput(res.output ?? ''),
      ...(res.sandbox ? { sandbox: res.sandbox } : {}),
      ...(res.error ? { spawnError: res.error } : {}),
    };
  };

  const engines = {
    /* JEXI-006: pytest is a first-class path, and is PREFERRED when the
       project looks like a Python test project. */
    async pytest_run({ path: target, args, timeoutMs }, ctx = {}) {
      const root = ctx.root ?? process.cwd();
      return runPytest(root, { path: target, args, timeoutMs });
    },

    async test_run({ file }, ctx = {}) {
      const root = ctx.root ?? process.cwd();
      const kind = detectProjectKind(root);
      if (!kind && !file) return { ok: false, status: 'error', reason: 'no test project detected (no package.json scripts, no pytest config, no tests/)', root };

      if (kind === 'pytest') return runPytest(root, { path: file });

      const cmd = detectTestCommand(root);
      if (!cmd && !file) return { ok: false, status: 'error', reason: 'no test command configured', root };
      const argv = file ? ['node', '--test', String(file)] : ['npm', 'test'];
      const res = await exec(argv, { root, timeoutMs: 60000 });
      const parsed = parseNodeTestReport(res.output ?? '', res.code ?? -1);
      return {
        framework: 'node', ...parsed,
        ok: parsed.status === 'pass',
        exitCode: res.code,
        command: argv.join(' '),
        root,
        output: evidenceOutput(res.output ?? '', 6000),
        failures: [],
      };
    },

    async test_coverage({ file }, ctx = {}) {
      const root = ctx.root ?? process.cwd();
      const res = await runNativeCommand('node', ['--experimental-test-coverage', '--test', String(file || '')], { cwd: root, timeoutMs: 60000, maxOutputChars: 30000 });
      return { ok: res.code === 0, exitCode: res.code, output: evidenceOutput(res.output ?? '', 8000) };
    },
  };
  return { unreg, engines };
}

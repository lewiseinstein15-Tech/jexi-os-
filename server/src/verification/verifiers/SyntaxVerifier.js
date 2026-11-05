/**
 * JEXI OS — VERIFICATION — SyntaxVerifier.
 *
 * M22 — the cheapest layer that can catch a malformed edit, and the one that
 * was MISSING for Python. The M21 measurement found that in a Python sandbox
 * the lint layer is INAPPLICABLE (ESLint is a JavaScript linter) and the unit
 * layer is UNVERIFIABLE (an exec-style HumanEval test file cannot be run by
 * pytest), so no layer ever told the model its file did not parse. Every
 * syntax-corrupt write therefore ended the turn with no feedback at all.
 *
 * This verifier runs the real Python compiler over the changed `.py` files
 * (`ast.parse`, which needs no `__pycache__` side effect) and layers the pure
 * structural reader on top for the shapes the compiler accepts but the task
 * rejects (a body wrapped in `"""` parses but defines nothing).
 *
 * HONESTY, matching the rest of the subsystem:
 *   - a file that does not compile is a `fail` with the real compiler message;
 *   - a file with a structural defect is a `fail` with a named defect;
 *   - a project with no Python files is `inapplicable` — skipped, not failed;
 *   - Python missing from the environment is `error` — never a canned pass;
 *   - `options.run` is the deterministic test seam.
 */

import fs from 'node:fs';
import path from 'node:path';

import { runCommand } from '../spawn/execute.js';
import { verifyCwd, cleanupSandbox } from '../spawn/sandbox.js';
import { detectProjectKind } from '../../tools/domains/testing/index.js';
import { analyzePythonSource } from '../analysis/python-structure.js';

/** Python files under a directory (one level; a sandbox is flat). */
function pythonFilesIn(dir, files = []) {
  if (files.length) return files.filter((f) => f.endsWith('.py'));
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith('.py')).map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

/**
 * The compiler probe: parse every file and exit nonzero on the first failure,
 * printing the real `SyntaxError` (file, line, caret, message).
 * Using `ast.parse` (not `py_compile`) keeps the workspace free of `__pycache__`.
 */
function compileProbe(files) {
  const script = [
    'import ast, sys',
    'for f in sys.argv[1:]:',
    '    try:',
    '        ast.parse(open(f, encoding="utf-8").read(), f)',
    '    except SyntaxError as e:',
    '        print(f"{e.__class__.__name__}: {e.msg} ({f}:{e.lineno})")',
    '        sys.exit(1)',
  ].join('\n');
  return [process.env.PYTHON || 'python3', '-c', script, ...files];
}

/** @type {import('../interface/Verifier.js').Verifier} */
export const SyntaxVerifier = {
  name: 'SyntaxVerifier',

  async verify({ snapshotId, snapshot, options = {} }) {
    const started = Date.now();
    const { run, cwd = process.cwd(), timeoutMs, files = [], entryPoint = null, solutionFile = 'solution.py', materialize } = options;

    if (typeof run === 'function') {
      const res = await run();
      const pass = res.exitCode === 0;
      return {
        status: pass ? 'pass' : 'fail',
        evidence: [{ source: 'SyntaxVerifier', snapshotId, content: res.output || `exitCode=${res.exitCode}`, at: Date.now() }],
        reason: pass ? undefined : 'syntax check failed',
        durationMs: Date.now() - started,
      };
    }

    const { cwd: runCwd, sandbox } = verifyCwd(snapshot, { cwd, materialize });
    const targets = pythonFilesIn(runCwd, files);
    if (!targets.length) {
      if (sandbox) cleanupSandbox(sandbox);
      return {
        status: 'inapplicable',
        evidence: [{ source: 'SyntaxVerifier', snapshotId, content: `no Python files to check (${detectProjectKind(runCwd) ?? 'unknown'} project)`, at: Date.now() }],
        reason: 'no Python source in this project — skipped, not failed',
        durationMs: Date.now() - started,
      };
    }

    /* 1. The real compiler. */
    const res = await runCommand(compileProbe(targets), { cwd: runCwd, timeoutMs });
    if (sandbox) cleanupSandbox(sandbox);
    if (!res.ok && res.spawnError && !res.stdout && !res.stderr) {
      return {
        status: 'error',
        evidence: [{ source: 'SyntaxVerifier', snapshotId, content: res.spawnError, at: Date.now() }],
        reason: `python interpreter unavailable: ${res.spawnError}`,
        durationMs: Date.now() - started,
      };
    }
    if (!res.ok) {
      const msg = (res.stderr || res.stdout || res.output || '').trim().split('\n').filter(Boolean).slice(-3).join('\n') || `python exited ${res.code}`;
      return {
        status: 'fail',
        evidence: [{ source: 'SyntaxVerifier', snapshotId, content: msg, at: Date.now(), meta: { spawn: { command: 'python3', args: ['-c', '<compile probe>', ...targets], exitCode: res.code } } }],
        reason: `Python syntax error: ${msg.split('\n').pop()}`,
        durationMs: Date.now() - started,
      };
    }

    /* 2. The structural reader — shapes the compiler ACCEPTS but the task
       rejects (a whole body wrapped in `"""` parses; a duplicate definition
       parses; a placeholder body parses). */
    const problems = [];
    for (const f of targets) {
      let src = '';
      try { src = fs.readFileSync(f, 'utf8'); } catch { continue; }
      /* The entry-point check applies ONLY to the file the task is producing
         (solution.py). A test file legitimately defines no entry point. */
      const isSolution = path.basename(f) === solutionFile;
      const a = analyzePythonSource(src, isSolution ? (entryPoint || null) : null);
      if (!a.ok) problems.push({ file: path.basename(f), defects: a.defects, detail: a.detail });
    }
    /* When the caller names an entry point, the file that must define it has to
       exist — a solution that was never written cannot pass a structure check. */
    if (entryPoint && !targets.some((f) => path.basename(f) === solutionFile)) {
      problems.push({ file: solutionFile, defects: ['missing-solution-file'], detail: {} });
    }
    if (problems.length) {
      const named = problems.map((p) => `${p.file}: ${p.defects.join(', ')}`).join('; ');
      return {
        status: 'fail',
        evidence: [{ source: 'SyntaxVerifier', snapshotId, content: `structural defect(s): ${named}`, at: Date.now(), meta: { problems } }],
        reason: `Python source structure: ${named}`,
        durationMs: Date.now() - started,
      };
    }

    return {
      status: 'pass',
      evidence: [{ source: 'SyntaxVerifier', snapshotId, content: `compiled ${targets.length} file(s) and found no structural defect`, at: Date.now() }],
      durationMs: Date.now() - started,
    };
  },
};

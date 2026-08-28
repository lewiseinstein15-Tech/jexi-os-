/**
 * B160 — PYTHON CODE RUNTIME (DeepSeek Harness
 * `packages/code-runtime/code-runtime-python` mirror).
 *
 * CPython subprocess implementation of the code-execution seam: the same
 * contract as the Node worker runtime (CodeModeRuntime.js) but executing a
 * Python program — bounded time, bounded output, deterministic structured
 * result. Used when a code-mode program requests python execution.
 *
 * Graceful degradation: hosts without python3 return PYTHON_UNAVAILABLE
 * (model-readable), never a crash.
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

export const PYTHON_TIMEOUT_MS = 20000;
export const PYTHON_MAX_OUTPUT = 64 * 1024;

let pythonBinary = undefined; // undefined = unprobed, null = missing, string = bin

/** Synchronously resolve an executable on PATH (an optimistic spawn probe
 *  always lies — missing binaries report an ASYNC error). */
function resolveOnPath(bin) {
  try {
    if (bin.includes('/') || bin.includes('\\')) return fs.existsSync(bin) ? bin : null;
    const exts = process.platform === 'win32' ? ['.exe', ''] : [''];
    for (const dir of (process.env.PATH || '').split(path.delimiter)) {
      if (!dir) continue;
      for (const ext of exts) {
        const full = path.join(dir, bin + ext);
        try { if (fs.statSync(full).isFile()) return full; } catch { /* keep scanning */ }
      }
    }
  } catch { /* fallthrough */ }
  return null;
}

/** Probe once for python3 (or python on Windows). */
export function pythonAvailable() {
  if (pythonBinary !== undefined) return pythonBinary;
  const candidates = process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python'];
  for (const bin of candidates) {
    const full = resolveOnPath(bin);
    if (full) { pythonBinary = full; return pythonBinary; }
  }
  pythonBinary = null;
  return null;
}

/**
 * Execute a Python program. Result mirrors the worker-runtime seam:
 * { ok, stdout, stderr, exitCode, timedOut?, truncated? }
 */
export function runPythonProgram(program, {
  timeoutMs = PYTHON_TIMEOUT_MS,
  maxOutput = PYTHON_MAX_OUTPUT,
  cwd,
  env = {},
  stdin = '',
} = {}) {
  return new Promise((resolve) => {
    const bin = pythonAvailable();
    if (!bin) {
      resolve({ ok: false, code: 'PYTHON_UNAVAILABLE', error: 'python3 is not installed on this host', stdout: '', stderr: '' });
      return;
    }
    let child;
    try {
      child = spawn(bin, ['-I', '-c', String(program || '')], { cwd, env: { ...env, PYTHONDONTWRITEBYTECODE: '1' } });
    } catch (e) {
      resolve({ ok: false, code: 'PYTHON_SPAWN_FAILED', error: e.message, stdout: '', stderr: '' });
      return;
    }
    let out = '';
    let err = '';
    let timedOut = false;
    let truncated = false;
    const push = (buf, which) => {
      const chunk = buf.toString('utf8');
      const target = which === 'err' ? (err += chunk) : (out += chunk);
      if (out.length > maxOutput) { out = out.slice(0, maxOutput); truncated = true; }
      if (err.length > maxOutput) { err = err.slice(0, maxOutput); truncated = true; }
      return target;
    };
    child.stdout.on('data', (d) => push(d, 'out'));
    child.stderr.on('data', (d) => push(d, 'err'));
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGKILL'); } catch { /* noop */ }
    }, Math.max(1000, timeoutMs));
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, code: 'PYTHON_SPAWN_FAILED', error: e.message, stdout: out, stderr: err });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        ok: !timedOut && code === 0,
        stdout: out,
        stderr: err,
        exitCode: timedOut ? null : code,
        ...(timedOut ? { timedOut: true } : {}),
        ...(truncated ? { truncated: true } : {}),
      });
    });
    if (stdin) { try { child.stdin.write(stdin); } catch { /* noop */ } }
    try { child.stdin.end(); } catch { /* noop */ }
  });
}

/** Model-facing tool shape for the Tool Registry / plugins. */
export async function pythonToolHandler(args) {
  const program = String((args && args.program) || (args && args.code) || '');
  if (!program.trim()) return { ok: false, error: 'program is required' };
  return runPythonProgram(program, { timeoutMs: Number((args && args.timeoutMs) || 20000) });
}

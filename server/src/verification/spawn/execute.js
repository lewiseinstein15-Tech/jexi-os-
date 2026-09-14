/**
 * JEXI OS — VERIFICATION — real subprocess execution.
 *
 * The spawn layer that makes verification REAL. Every executable verifier
 * (Test/Build/Lint) funnels through runCommand, which:
 *
 *   - resolves the binary the same way npm does (node_modules/.bin walk-up,
 *     then PATH fallback — the pattern built in Scope A for the LSP domain);
 *   - spawns a child process with child_process.spawn (no shell), capturing
 *     stdout AND stderr separately;
 *   - bounds output size and wall-clock time (a runaway verifier is killed);
 *   - returns a structured result with the raw output intact.
 *
 * A verifier that cannot resolve a command, cannot spawn, or times out is an
 * 'error' — never a silent pass.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Resolve a CLI binary the same way npm does: node_modules/.bin under the
 * module's package tree, walking up until found; fall back to PATH.
 */
export function resolveBin(name) {
  let dir = path.resolve(__dir, '..');
  for (;;) {
    const binPath = path.join(dir, 'node_modules', '.bin', name);
    if (fs.existsSync(binPath)) return binPath;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return name;
}

/**
 * Read a configured verification command from the nearest package.json.
 * A command entry is either a string ("node --test ..."), or an array of the
 * form [command, ...args].
 * @returns {string[]|null} resolved [command, ...args], or null if not configured
 */
export function resolveConfiguredCommand(baseDir, key) {
  let dir = path.resolve(baseDir || process.cwd());
  for (;;) {
    const pkgFile = path.join(dir, 'package.json');
    if (fs.existsSync(pkgFile)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
        const spec = pkg?.jexi?.verify?.[key];
        if (spec) return normalizeCommandSpec(spec);
      } catch { /* unreadable package.json — walk up */ }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Coerce a command spec to [cmd, ...args]; a bare plain-string command with
 * spaces is split (npm-style), otherwise it is treated as a single binary. */
export function normalizeCommandSpec(spec) {
  if (Array.isArray(spec)) return spec.map((x) => String(x)).filter(Boolean);
  const s = String(spec ?? '').trim();
  if (!s) return null;
  const parts = s.split(/\s+/);
  return parts;
}

/**
 * Run a real command in a real child process.
 * @param {string|string[]} commandSpec  — command or [cmd, ...args]
 * @param {object} [o]
 * @param {string} [o.cwd]
 * @param {number} [o.timeoutMs]
 * @param {number} [o.maxOutputChars]
 * @param {object} [o.env]
 * @returns {Promise<{ok:boolean, code:number|null, stdout:string, stderr:string, output:string, failures:string[], timedOut:boolean, spawnError?:string}>}
 */
export async function runCommand(commandSpec, { cwd = process.cwd(), timeoutMs = 60000, maxOutputChars = 64000, env = {} } = {}) {
  const spec = Array.isArray(commandSpec) ? commandSpec : normalizeCommandSpec(String(commandSpec ?? ''));
  if (!spec?.length) return { ok: false, code: null, stdout: '', stderr: '', output: '', failures: [], timedOut: false, spawnError: 'no command configured' };

  const [command0, ...args] = spec;
  // resolveBin walks node_modules/.bin first (eslint), falls back to PATH
  // (node), which also covers npm/npx on POSIX when no local .bin shim exists.
  const command = resolveBin(command0);
  const started = Date.now();

  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd,
        env: { ...process.env, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
      });
    } catch (e) {
      resolve({ ok: false, code: null, stdout: '', stderr: '', output: '', failures: [], timedOut: false, spawnError: `spawn failed: ${(e && e.message) || e}` });
      return;
    }

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    child.stdout.on('data', (d) => { stdout = (stdout + d.toString('utf8')).slice(-maxOutputChars); });
    child.stderr.on('data', (d) => { stderr = (stderr + d.toString('utf8')).slice(-maxOutputChars); });

    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
    }, timeoutMs);

    child.on('close', (code) => {
      clearTimeout(timer);
      const output = (stdout || stderr).trim();
      const failures = timedOut
        ? [`timed out after ${timeoutMs}ms`]
        : stderr.trim()
          ? stderr.trim().split('\n').slice(-20)
          : [];
      resolve({
        ok: code === 0 && !timedOut,
        code,
        stdout: stdout.slice(0, maxOutputChars),
        stderr: stderr.slice(0, maxOutputChars),
        output: output.slice(0, maxOutputChars),
        failures,
        timedOut,
        durationMs: Date.now() - started,
        ...(code !== 0 && !timedOut ? { spawnError: (stderr || `exited ${code}`).slice(0, 1000) } : {}),
      });
    });

    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, code: null, stdout: '', stderr: '', output: '', failures: [], timedOut: false, spawnError: `spawn error: ${(e && e.message) || e}` });
    });
  });
}
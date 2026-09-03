/**
 * B210 — COMMAND RUNNER: employees can REALLY execute commands.
 *
 * This closes the last §27 gap (COMMAND_* / TEST_* events) the honest way:
 * not by emitting decorative events, but by giving suitably-permissioned
 * employees (EXECUTE) a real, allowlisted command executor inside their
 * task workspace.
 *
 * Safety model (every layer real, none decorative):
 *   1. NO SHELL — execFile(binary, args): pipes, `&&`, `$()`, redirects are
 *      syntactically impossible, not merely discouraged.
 *   2. BINARY ALLOWLIST — read/inspect/compute binaries + language runtimes.
 *      No rm/mv/cp (writes go through the artifact path), no network tools
 *      (search is a tool, not a shell), no package managers (arbitrary
 *      install scripts).
 *   3. FLAG ALLOWLIST — args may not start with '-' except --test, -m,
 *      --version, -v (covers `node --test` and `python3 -m pytest`).
 *   4. CWD SANDBOX — every command runs inside the task's own directory
 *      (jexi-workspace/director/<taskId>/), the same place artifacts land.
 *   5. SCRUBBED ENV — the ShellEnv secrets scrubber (fail-closed) builds
 *      the child environment; provider keys never reach employee code.
 *   6. BOUNDS — timeout (kill), output cap, command length, args count.
 */

import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'node:url';
import { shellEnv } from '../ShellEnv.js'; // B136 — secrets-scrubbed child env

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const COMMAND_WORKSPACE_ROOT = path.join(HERE, '..', '..', '..', 'jexi-workspace', 'director');

/** Binaries an employee may run. Deliberately tiny; grows only by decision. */
export const ALLOWED_BINARIES = new Set([
  'node', 'python3', 'python',
  'ls', 'cat', 'head', 'tail', 'wc', 'grep', 'echo', 'printf', 'diff', 'sort', 'uniq',
]);

/** The only leading-dash args permitted (test runners + version). */
const ALLOWED_FLAGS = new Set(['--test', '-m', '--version', '-v', '-V']);

export const COMMAND_LIMITS = {
  timeoutMs: 30000,     // hard kill after this
  maxOutputBytes: 16384, // output cap (protects the model context)
  maxArgs: 8,
  maxArgLength: 200,
  maxCommandLength: 400,
};

/** Recognized test invocations (get TEST_* events instead of COMMAND_*). */
export function isTestCommand(command) {
  const parts = parseCommand(command);
  if (!parts) return false;
  const [bin, ...args] = parts;
  if (bin === 'node') return args.includes('--test');
  if (bin === 'python3' || bin === 'python') return args[0] === '-m' && /pytest|unittest/.test(args[1] || '');
  return false;
}

/** Split a command line into binary + args (no shell semantics at all). */
export function parseCommand(command) {
  const line = String(command || '').trim().replace(/\s+/g, ' ');
  if (!line || line.length > COMMAND_LIMITS.maxCommandLength) return null;
  return line.split(' ');
}

/**
 * Validate a command against the allowlists. Returns {ok} or {ok:false, reason}.
 */
export function validateCommand(command) {
  const parts = parseCommand(command);
  if (!parts) return { ok: false, reason: 'empty or oversized command' };
  const [bin, ...args] = parts;
  if (!ALLOWED_BINARIES.has(bin)) return { ok: false, reason: `"${bin}" is not in the employee command allowlist` };
  if (args.length > COMMAND_LIMITS.maxArgs) return { ok: false, reason: `too many arguments (max ${COMMAND_LIMITS.maxArgs})` };
  for (const a of args) {
    if (a.length > COMMAND_LIMITS.maxArgLength) return { ok: false, reason: 'argument too long' };
    if (a.startsWith('-') && !ALLOWED_FLAGS.has(a)) return { ok: false, reason: `flag "${a}" is not allowed` };
  }
  return { ok: true, parts };
}

export function taskCommandDir(taskId) {
  return path.join(COMMAND_WORKSPACE_ROOT, String(taskId || 'task').replace(/[^\w-]/g, '_'));
}

/**
 * The task workspace sits inside the server tree, whose package.json is
 * "type":"module" — without this, employee .js scripts default to ESM and
 * `require(...)` dies. Every task dir gets its own CommonJS package.json so
 * scripts behave predictably (and `node --test` works out of the box).
 */
function ensureCommonJs(cwd) {
  try {
    const pj = path.join(cwd, 'package.json');
    if (!fs.existsSync(pj)) fs.writeFileSync(pj, JSON.stringify({ name: 'jexi-task-workspace', private: true, type: 'commonjs' }, null, 2));
  } catch { /* best-effort; execution still proceeds */ }
}

/**
 * Run one allowlisted command inside the task workspace.
 * @returns {Promise<{ok:boolean, exitCode:number, output:string, ms:number, timedOut?:boolean, blocked?:boolean, reason?:string}>}
 */
export function runEmployeeCommand({ taskId, command, timeoutMs, env }) {
  const gate = validateCommand(command);
  if (!gate.ok) {
    return Promise.resolve({ ok: false, exitCode: null, output: '', ms: 0, blocked: true, reason: gate.reason });
  }
  const [bin, ...args] = gate.parts;
  const cwd = taskCommandDir(taskId);
  try { fs.mkdirSync(cwd, { recursive: true }); } catch { /* exists */ }
  ensureCommonJs(cwd);
  const t0 = Date.now();
  const timeout = Math.min(Number(timeoutMs) || COMMAND_LIMITS.timeoutMs, COMMAND_LIMITS.timeoutMs);
  return new Promise((resolve) => {
    try {
      const child = execFile(bin, args, {
        cwd,
        timeout,
        killSignal: 'SIGKILL',
        maxBuffer: COMMAND_LIMITS.maxOutputBytes * 4,
        env: env || shellEnv({ convId: String(taskId || '').slice(0, 40) }),
        windowsHide: true,
      }, (err, stdout, stderr) => {
        const ms = Date.now() - t0;
        const timedOut = Boolean(err && err.killed && /TIMED?OUT/i.test(String(err.signal || '') + String(err.code || ''))) || Boolean(err && err.signal === 'SIGKILL');
        const raw = `${stdout || ''}${stderr ? (stdout ? '\n' : '') + stderr : ''}`;
        const output = raw.length > COMMAND_LIMITS.maxOutputBytes
          ? `${raw.slice(0, COMMAND_LIMITS.maxOutputBytes)}\n…[output truncated at ${COMMAND_LIMITS.maxOutputBytes} bytes]`
          : raw;
        const exitCode = err ? (typeof err.code === 'number' ? err.code : (timedOut ? 124 : 1)) : 0;
        resolve({
          ok: !err && exitCode === 0,
          exitCode,
          output,
          ms,
          ...(timedOut ? { timedOut: true } : {}),
          ...(err && !timedOut ? { reason: String(err.message || '').slice(0, 120) } : {}),
        });
      });
      // belt-and-braces: never leak stdio streams
      child.on('error', () => { /* handled via callback err */ });
    } catch (e) {
      resolve({ ok: false, exitCode: 127, output: '', ms: Date.now() - t0, reason: String(e.message || e).slice(0, 120) });
    }
  });
}

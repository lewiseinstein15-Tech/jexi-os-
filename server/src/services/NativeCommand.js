/**
 * B144 — NATIVE COMMAND (DeepSeek Harness `packages/util/native-command`
 * mirror, JEXI-branded).
 *
 * Run one native command (no shell) with a scrubbed environment, bounded
 * output, and a timeout — the fail-open utility used by diagnostics and
 * the headless CLI. Returns { ok, output, code, durationMs }.
 *
 * P11 B3/B4 — every run is traced through CommandTrace so an open chat
 * turn streams it INLINE as `command` NDJSON events (running → done with
 * real stdout/stderr + exit + duration). The trace is fail-soft and
 * subscriber-less when no turn is open.
 */

import { spawn } from 'child_process';
import path from 'path';
import { shellEnv } from './ShellEnv.js';
import { traceBufferedCommand } from './CommandTrace.js';

export async function runNativeCommand(command, args = [], { timeoutMs = 15000, cwd = process.cwd(), maxOutputChars = 16000, env = {}, displayCmd = null } = {}) {
  if (!String(command || '').trim()) return { ok: false, error: 'command required' };
  // The displayed command line: the caller's clean form when provided (e.g.
  // the terminal runner shows `ls -la`, not `bash -lc 'ls -la'`), otherwise
  // the shell-quoted raw argv — exactly what a terminal would show.
  const display = displayCmd || [command, ...args.map((a) => (/\s/.test(String(a)) ? `'${String(a).replaceAll("'", `'\\''`)}'` : String(a)))].join(' ');
  return traceBufferedCommand({
    cmd: display,
    source: `native:${path.basename(String(command))}`,
    exec: () => runNativeCommandInner(command, args, { timeoutMs, cwd, maxOutputChars, env }),
  });
}

async function runNativeCommandInner(command, args = [], { timeoutMs = 15000, cwd = process.cwd(), maxOutputChars = 16000, env = {} } = {}) {
  const started = Date.now();
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, { cwd, env: shellEnv({ extra: env }), stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      resolve({ ok: false, error: `spawn failed: ${(e && e.message) || e}`, durationMs: Date.now() - started });
      return;
    }
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout = (stdout + d.toString('utf8')).slice(-maxOutputChars); });
    child.stderr.on('data', (d) => { stderr = (stderr + d.toString('utf8')).slice(-maxOutputChars); });
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* noop */ } }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      const output = (stdout || stderr).trim();
      resolve({
        ok: code === 0,
        output: output.slice(0, maxOutputChars),
        stdout: stdout.slice(0, maxOutputChars),
        stderr: stderr.slice(0, maxOutputChars),
        code,
        durationMs: Date.now() - started,
        ...(code !== 0 ? { error: (stderr || `exited ${code}`).slice(0, 1000) } : {}),
      });
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, error: (e && e.message) || 'spawn error', durationMs: Date.now() - started });
    });
  });
}

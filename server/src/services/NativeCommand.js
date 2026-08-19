/**
 * B144 — NATIVE COMMAND (DeepSeek Harness `packages/util/native-command`
 * mirror, JEXI-branded).
 *
 * Run one native command (no shell) with a scrubbed environment, bounded
 * output, and a timeout — the fail-open utility used by diagnostics and
 * the headless CLI. Returns { ok, output, code, durationMs }.
 */

import { spawn } from 'child_process';
import { shellEnv } from './ShellEnv.js';

export async function runNativeCommand(command, args = [], { timeoutMs = 15000, cwd = process.cwd(), maxOutputChars = 16000, env = {} } = {}) {
  if (!String(command || '').trim()) return { ok: false, error: 'command required' };
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

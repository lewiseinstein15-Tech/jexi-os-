/**
 * B136 — SUBPROCESS LOCAL (DeepSeek Harness
 * `packages/subprocess/subprocess-local` mirror, JEXI-branded).
 *
 * Managed process-tree provider: spawn a child with a scrubbed environment,
 * keep a bounded output tail, offer tree-scoped termination with the
 * SIGTERM → SIGKILL escalation ladder (POSIX process groups; taskkill /T /F
 * on Windows), and report structured status (pid, status, exit code, output
 * tail, duration). Fail-closed: a spawn error is an honest
 * { ok:false, error } outcome, never a hang.
 */

import { spawn, spawnSync } from 'child_process';
import crypto from 'crypto';
import { shellEnv } from './ShellEnv.js';

const MAX_PROCESSES = 32;
const MAX_OUTPUT_CHARS = 256 * 1024;
const SIGKILL_GRACE_MS = 2000;

const processes = new Map(); // id → record

function record(id, child, spec) {
  const rec = {
    id,
    pid: child.pid,
    command: String(spec.command || '').slice(0, 200),
    args: (spec.args || []).slice(0, 32),
    cwd: spec.cwd || process.cwd(),
    status: 'running',
    exitCode: null,
    output: '',
    stdout: '',
    stderr: '',
    startedAt: Date.now(),
    endedAt: null,
    durationMs: null,
  };
  const push = (stream, chunk) => {
    rec[stream] = (rec[stream] + chunk.toString('utf8')).slice(-MAX_OUTPUT_CHARS);
    rec.output = (rec.stdout + rec.stderr).slice(-MAX_OUTPUT_CHARS);
  };
  child.stdout && child.stdout.on('data', (d) => push('stdout', d));
  child.stderr && child.stderr.on('data', (d) => push('stderr', d));
  child.on('error', (e) => {
    rec.status = 'error';
    rec.stderr += String((e && e.message) || e).slice(-2000);
    rec.endedAt = Date.now();
    rec.durationMs = rec.endedAt - rec.startedAt;
  });
  child.on('exit', (code, signal) => {
    rec.status = signal ? `killed(${signal})` : 'exited';
    rec.exitCode = code;
    rec.endedAt = Date.now();
    rec.durationMs = rec.endedAt - rec.startedAt;
  });
  return rec;
}

/**
 * Spawn one managed subprocess.
 * @param {object} spec { command, args?, cwd?, env?, timeoutMs?, signal? }
 * @returns {Promise<{ok, id?, pid?, error?}>} resolves when the process
 *   settles (or times out / is signalled).
 */
export function spawnManaged(spec) {
  const command = String((spec && spec.command) || '').trim();
  if (!command) return Promise.resolve({ ok: false, error: 'command required' });
  if (processes.size >= MAX_PROCESSES) {
    return Promise.resolve({ ok: false, error: `too many managed subprocesses (max ${MAX_PROCESSES})` });
  }
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, (spec && spec.args) || [], {
        cwd: (spec && spec.cwd) || process.cwd(),
        env: shellEnv({ extra: (spec && spec.env) || {} }),
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
      });
    } catch (e) {
      resolve({ ok: false, error: `spawn failed: ${(e && e.message) || e}` });
      return;
    }
    const id = `proc-${crypto.randomUUID().slice(0, 12)}`;
    const rec = record(id, child, { command, args: (spec && spec.args) || [], cwd: (spec && spec.cwd) });
    processes.set(id, rec);
    // Timeout ladder: SIGTERM → (grace) → SIGKILL, tree-scoped.
    let timer = null;
    if (spec && Number.isInteger(spec.timeoutMs) && spec.timeoutMs > 0) {
      timer = setTimeout(() => {
        if (rec.status !== 'running') return;
        terminateTree(rec, 'SIGTERM');
        setTimeout(() => {
          if (rec.status === 'running') terminateTree(rec, 'SIGKILL');
        }, SIGKILL_GRACE_MS).unref();
      }, spec.timeoutMs);
      if (timer.unref) timer.unref();
    }
    const settle = () => {
      if (timer) { clearTimeout(timer); timer = null; }
      resolve({
        ok: rec.status === 'exited' && rec.exitCode === 0,
        id,
        pid: rec.pid,
        status: rec.status,
        exitCode: rec.exitCode,
        output: rec.output.slice(-12000),
        stdout: rec.stdout.slice(-12000),
        stderr: rec.stderr.slice(-4000),
        durationMs: rec.durationMs,
        ...(rec.status !== 'exited' || rec.exitCode !== 0 ? { error: rec.status === 'running' ? 'timeout' : rec.status } : {}),
      });
    };
    if (rec.status !== 'running') {
      // synchronous-ish spawn error / immediate exit
      setTimeout(settle, 30);
      return;
    }
    child.on('exit', settle);
    child.on('error', settle);
    // External abort signal → tree kill.
    if (spec && spec.signal) {
      if (spec.signal.aborted) { terminateTree(rec, 'SIGKILL'); }
      else spec.signal.addEventListener('abort', () => terminateTree(rec, 'SIGKILL'), { once: true });
    }
  });
}

/** Tree-scoped termination: POSIX process-group signal; Windows taskkill /T. */
export function terminateTree(rec, sig = 'SIGTERM') {
  if (!rec || rec.status !== 'running') return { ok: false, error: 'not running' };
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(rec.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      try { process.kill(-rec.pid, sig); } catch { process.kill(rec.pid, sig); }
    }
    return { ok: true, pid: rec.pid, signal: sig };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

/** Kill a managed subprocess by id (graceful then force). */
export async function killManaged(id) {
  const rec = processes.get(String(id || ''));
  if (!rec) return { ok: false, error: `no managed subprocess "${id}"` };
  terminateTree(rec, 'SIGTERM');
  await new Promise((r) => setTimeout(r, 400));
  if (rec.status === 'running') terminateTree(rec, 'SIGKILL');
  return { ok: true, id, pid: rec.pid };
}

/** List live managed subprocesses. */
export function listManagedProcesses() {
  return [...processes.values()].map((r) => ({
    id: r.id, pid: r.pid, command: r.command, args: r.args, cwd: r.cwd,
    status: r.status, exitCode: r.exitCode, durationMs: r.durationMs,
    outputBytes: Buffer.byteLength(r.output), stdoutBytes: Buffer.byteLength(r.stdout), stderrBytes: Buffer.byteLength(r.stderr),
  }));
}

/** Drop finished records beyond a retention cap (boot + hourly). */
export function reapManagedProcesses({ keep = 64 } = {}) {
  const finished = [...processes.values()].filter((r) => r.status !== 'running');
  if (finished.length <= keep) return;
  const byAge = finished.sort((a, b) => (a.endedAt || 0) - (b.endedAt || 0));
  while (byAge.length > keep) {
    const victim = byAge.shift();
    processes.delete(victim.id);
  }
}

/** Terminate everything (shutdown). */
export function closeAllManagedProcesses() {
  for (const rec of processes.values()) {
    if (rec.status === 'running') terminateTree(rec, 'SIGKILL');
  }
  processes.clear();
}

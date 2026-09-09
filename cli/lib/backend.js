/**
 * JEXI CLI — local backend supervisor.
 *
 * `jexi` runs the brain on the laptop itself (127.0.0.1, open backend):
 * no cloud needed for local engineering. The backend is spawned detached,
 * tracked via a pidfile, and health-gated before any command proceeds.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { paths } from './config.js';
import { JexiApi } from './api.js';

export function readPid(home) {
  try {
    const p = paths(home).pid;
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return null;
  }
}

export function writePid(meta, home) {
  try {
    fs.writeFileSync(paths(home).pid, JSON.stringify(meta, null, 2));
    return true;
  } catch {
    return false;
  }
}

export function clearPid(home) {
  try { fs.unlinkSync(paths(home).pid); } catch { /* already gone */ }
}

/** Is this pid alive? (portable: kill(0) probe). */
export function pidAlive(pid) {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Wait for /api/health (no key needed). Returns { ok, ms, error? }. */
export async function waitHealthy(api, { timeoutMs = 45000, intervalMs = 500 } = {}) {
  const t0 = Date.now();
  let lastErr = 'not started';
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await api.health();
      if (r.ok && r.data && r.data.ok) return { ok: true, ms: Date.now() - t0 };
      lastErr = `HTTP ${r.status}`;
    } catch (e) {
      lastErr = String((e && e.message) || e).slice(0, 120);
    }
    await sleep(intervalMs);
  }
  return { ok: false, ms: Date.now() - t0, error: lastErr };
}

/**
 * Ensure a healthy backend for this workspace. Starts one when needed.
 * Returns { api, started, reused, workspace } or throws with a clear error.
 */
export async function ensureBackend({ cfg, serverDir, workspace, home, onLog = null }) {
  const log = (m) => { try { onLog?.(m); } catch {} };
  const meta = readPid(home);
  const api = new JexiApi({ baseUrl: `http://${cfg.host}:${cfg.port}` });
  const sameWorkspace = (w) => path.resolve(w) === path.resolve(workspace);

  if (meta && meta.pid && pidAlive(meta.pid)) {
    if (meta.workspace && !sameWorkspace(meta.workspace)) {
      throw new Error(
        `backend already serves a different workspace:\n  running: ${meta.workspace}\n  current: ${workspace}\n` +
        `Run "jexi restart" to switch it here, or "jexi stop" first.`,
      );
    }
    const h = await waitHealthy(api, { timeoutMs: 8000 });
    if (h.ok) return { api, started: false, reused: true, workspace: meta.workspace || workspace };
    log('stale backend pid — restarting…');
    try { process.kill(meta.pid, 'SIGTERM'); } catch {}
    clearPid(home);
  }

  // Fresh start.
  if (!fs.existsSync(path.join(serverDir, 'index.js'))) {
    throw new Error(`backend not found at ${serverDir} (re-run the installer)`);
  }
  if (!fs.existsSync(path.join(serverDir, 'node_modules'))) {
    throw new Error(`backend dependencies missing — run: cd ${serverDir} && npm ci`);
  }
  const ps = paths(home);
  fs.mkdirSync(ps.home, { recursive: true });
  fs.mkdirSync(ps.data, { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });
  const logFd = fs.openSync(ps.log, 'a');
  const child = spawn(process.execPath, ['index.js'], {
    cwd: serverDir,
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: {
      ...process.env,
      PORT: String(cfg.port),
      HOST: cfg.host || '127.0.0.1',
      WORKSPACE_DIR: workspace,
      DATA_DIR: ps.data,
    },
  });
  child.unref();
  try { fs.closeSync(logFd); } catch {}
  writePid({ pid: child.pid, workspace, port: cfg.port, startedAt: new Date().toISOString() }, home);

  const h = await waitHealthy(api, { timeoutMs: 90000 });
  if (!h.ok) {
    try { process.kill(child.pid, 'SIGTERM'); } catch {}
    clearPid(home);
    throw new Error(`backend failed to come up (${h.error}). See ${ps.log}`);
  }
  return { api, started: true, reused: false, workspace };
}

/** Stop the backend (SIGTERM, then SIGKILL after a grace period). */
export async function stopBackend(home, { graceMs = 4000 } = {}) {
  const meta = readPid(home);
  if (!meta || !meta.pid) { clearPid(home); return { stopped: false, reason: 'not running' }; }
  if (!pidAlive(meta.pid)) { clearPid(home); return { stopped: false, reason: 'stale pidfile (cleaned)' }; }
  try { process.kill(meta.pid, 'SIGTERM'); } catch {}
  const t0 = Date.now();
  while (pidAlive(meta.pid) && Date.now() - t0 < graceMs) await sleep(200);
  if (pidAlive(meta.pid)) {
    try { process.kill(meta.pid, 'SIGKILL'); } catch {}
  }
  clearPid(home);
  return { stopped: true, pid: meta.pid };
}

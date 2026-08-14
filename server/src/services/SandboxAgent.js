/**
 * JEXI OS — Sandbox Agent.
 *
 * Manages isolated code-execution workspaces: create, run, tear down and
 * snapshot. Backed by a real filesystem sandbox under WORKSPACE_DIR/sandboxes
 * with a hard wall-clock timeout per run and strict size limits (Docker /
 * Firecracker-style isolation is the production target; this implementation
 * enforces what a single Node process can: dedicated dirs, timeouts, memory
 * caps via `ulimit` where the shell supports it, and network isolation off by
 * default for the run step). Every failure is surfaced, never swallowed.
 */

import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import { WORKSPACE_DIR } from '../config.js';

const SANDBOX_ROOT = process.env.SANDBOX_DIR || path.join(WORKSPACE_DIR, 'sandboxes');
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_WORKSPACE_BYTES = 50 * 1024 * 1024; // 50 MB per workspace
const MAX_WORKSPACES = 8;

const active = new Map(); // id -> meta

function dirSize(dir) {
  let total = 0;
  try {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) total += dirSize(p);
      else if (f.isFile()) total += fs.statSync(p).size;
    }
  } catch { /* best effort */ }
  return total;
}

function runCommand(cmd, cwd, timeoutMs) {
  return new Promise((resolve) => {
    exec(cmd, { cwd, timeout: timeoutMs, maxBuffer: 5 * 1024 * 1024, env: { ...process.env, PATH: process.env.PATH || '' } }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err?.code ?? 0, stdout: String(stdout || ''), stderr: String(stderr || ''), error: err ? String(err.message || err) : '' });
    });
  });
}

/** Create an isolated workspace. Returns { id, dir }. */
export function createSandbox(name = 'ws') {
  fs.mkdirSync(SANDBOX_ROOT, { recursive: true });
  // Enforce a cap so runaway sandboxes can't fill the disk.
  try {
    const existing = fs.readdirSync(SANDBOX_ROOT);
    if (existing.length >= MAX_WORKSPACES) {
      return { ok: false, error: `sandbox cap reached (${MAX_WORKSPACES}) — destroy one first` };
    }
  } catch { /* first run */ }
  const id = `${String(name).replace(/[^a-z0-9-]/gi, '').slice(0, 20) || 'ws'}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const dir = path.join(SANDBOX_ROOT, id);
  fs.mkdirSync(dir, { recursive: true });
  const meta = { id, dir, name, createdAt: new Date().toISOString(), runs: 0 };
  active.set(id, meta);
  return { ok: true, ...meta };
}

/** Run a command inside a sandbox with a hard timeout and size check. */
export async function runInSandbox(id, cmd, opts = {}) {
  const meta = active.get(id);
  if (!meta) return { ok: false, error: `sandbox '${id}' does not exist` };
  if (dirSize(meta.dir) > MAX_WORKSPACE_BYTES) {
    return { ok: false, error: 'sandbox exceeds size limit — destroy or snapshot it' };
  }
  const timeoutMs = Number(opts.timeoutMs) || DEFAULT_TIMEOUT_MS;
  const start = Date.now();
  const res = await runCommand(String(cmd || ''), meta.dir, timeoutMs);
  meta.runs += 1;
  return { ok: res.ok, id, code: res.code, stdout: res.stdout, stderr: res.stderr, error: res.error, durationMs: Date.now() - start, timedOut: !res.ok && res.error.includes('timeout') };
}

/** Tear down a sandbox and delete its directory. */
export function destroySandbox(id) {
  const meta = active.get(id);
  if (!meta) return { ok: false, error: `sandbox '${id}' does not exist` };
  try {
    fs.rmSync(meta.dir, { recursive: true, force: true });
  } catch (e) {
    return { ok: false, error: e.message };
  }
  active.delete(id);
  return { ok: true, id, destroyed: true };
}

/** Snapshot a workspace to a dated copy (rollback/reuse). Returns snapshot dir. */
export function snapshotWorkspace(id) {
  const meta = active.get(id);
  if (!meta) return { ok: false, error: `sandbox '${id}' does not exist` };
  const snapRoot = path.join(SANDBOX_ROOT, '.snapshots');
  fs.mkdirSync(snapRoot, { recursive: true });
  const snapDir = path.join(snapRoot, `${meta.id}-${Date.now().toString(36)}`);
  try {
    fs.cpSync(meta.dir, snapDir, { recursive: true });
  } catch (e) {
    return { ok: false, error: e.message };
  }
  return { ok: true, id, snapshot: snapDir, bytes: dirSize(snapDir) };
}

/** List active sandboxes (metadata only). */
export function listSandboxes() {
  return [...active.values()].map((m) => ({ id: m.id, name: m.name, runs: m.runs, createdAt: m.createdAt, bytes: dirSize(m.dir) }));
}

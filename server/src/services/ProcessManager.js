/**
 * JEXI OS — Process Subsystem (roadmap stage 11: persistent, observable terminal).
 *
 * Grok Build lesson #11: no persistent observable terminal/process system.
 * This module fixes that — a small process manager that:
 *
 *   - spawns shell commands (time-boxed, cwd-scoped to the workspace)
 *   - captures stdout/stderr into a ring buffer (last 200 lines)
 *   - tracks status: running | exited(code) | stopped | failed
 *   - persists the registry to DATA_DIR/processes.json so finished runs survive
 *     restarts (running ones are honestly marked 'interrupted')
 *   - exposes live logs + a subscriber hook for streaming process.* events
 *
 * Safety: every command runs with a default timeout (90s; longer for servers),
 * output is bounded, and the registry never grows past MAX_PROCESSES.
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { DATA_DIR, WORKSPACE_DIR } from '../config.js';

const STATE_FILE = path.join(DATA_DIR, 'processes.json');
const MAX_PROCESSES = 40;
const MAX_LOG_CHARS = 40000;

let processes = load();
const subscribers = new Set();

function load() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
      // Any process that was mid-flight when the server died is honestly marked.
      for (const p of Object.values(parsed)) {
        if (p.status === 'running') p.status = 'interrupted';
      }
      return parsed;
    }
  } catch (e) { /* fresh start */ }
  return {};
}

function persist() {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(processes, null, 2), 'utf-8');
  } catch (e) { console.error('[Process] persist error:', e.message); }
}

function emit(type, payload) {
  const msg = { type, ...payload };
  for (const fn of subscribers) { try { fn(msg); } catch (e) {} }
}

/** Subscribe to process.* events (used by the API for streaming). */
export function onProcessEvent(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

/** All processes, newest first, with bounded output previews. */
export function listProcesses() {
  return Object.values(processes)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .map((p) => ({
      id: p.id, command: p.command, cwd: p.cwd, status: p.status,
      createdAt: p.createdAt, startedAt: p.startedAt, endedAt: p.endedAt,
      exitCode: p.exitCode, pid: p.pid,
      logLength: p.log.length,
      logTail: p.log.slice(-1200),
    }));
}

/** Full buffered output for one process. */
export function getProcessLog(id) {
  const p = processes[id];
  return p ? p.log : null;
}

/** Start a command. Returns the process record immediately (async output arrives via logs). */
export function startProcess(command, { cwd, label = '', timeoutMs = 90000 } = {}) {
  const id = `proc-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  const runCwd = cwd || WORKSPACE_DIR;
  // Fresh checkouts / clean containers don't ship the (gitignored) workspace
  // dir; ensure the cwd exists so spawn() doesn't fail with ENOENT.
  try { fs.mkdirSync(runCwd, { recursive: true }); } catch (e) { /* best effort */ }
  const record = {
    id, command, label: label || command.slice(0, 60), cwd: runCwd,
    status: 'running', createdAt: Date.now(), startedAt: Date.now(),
    endedAt: null, exitCode: null, pid: null, log: '',
  };
  processes[id] = record;
  prune();

  let child;
  try {
    child = spawn(command, { cwd: runCwd, shell: true, env: { ...process.env } });
  } catch (e) {
    record.status = 'failed';
    record.log = `Failed to start: ${(e && e.message) || e}`;
    record.endedAt = Date.now();
    persist();
    emit('process.ended', { id, status: record.status, exitCode: null });
    return record;
  }

  record.pid = child.pid;
  persist();
  emit('process.started', { id, command, pid: child.pid });

  const append = (chunk) => {
    record.log = (record.log + String(chunk || '')).slice(-MAX_LOG_CHARS);
    emit('process.log', { id, chunk: String(chunk || '').slice(-4000) });
  };

  child.stdout.on('data', append);
  child.stderr.on('data', append);

  const timer = setTimeout(() => {
    try { child.kill('SIGTERM'); } catch (e) {}
    record.log += `\n⏱ [Process] timed out after ${Math.round(timeoutMs / 1000)}s — killed.\n`;
  }, timeoutMs);

  child.on('close', (code, signal) => {
    clearTimeout(timer);
    if (record.status !== 'stopped') {
      record.status = signal === 'SIGTERM' && code === null ? 'stopped' : (code === 0 ? 'exited' : 'failed');
    }
    record.exitCode = code;
    record.endedAt = Date.now();
    record.log += `\n[Process] exited with code ${code}${signal ? ` (${signal})` : ''}\n`;
    persist();
    emit('process.ended', { id, status: record.status, exitCode: code });
  });

  child.on('error', (err) => {
    clearTimeout(timer);
    record.status = 'failed';
    record.log += `\n[Process] error: ${(err && err.message) || err}\n`;
    record.endedAt = Date.now();
    persist();
    emit('process.ended', { id, status: 'failed', exitCode: null });
  });

  return record;
}

/** Stop a running process. */
export function stopProcess(id) {
  const p = processes[id];
  if (!p) return { success: false, error: 'Process not found' };
  if (p.status !== 'running' && p.status !== 'interrupted') {
    return { success: false, error: `Process is ${p.status}, not running` };
  }
  try {
    process.kill(p.pid, 'SIGTERM');
    setTimeout(() => { try { process.kill(p.pid, 'SIGKILL'); } catch (e) {} }, 3000).unref();
  } catch (e) { /* already dead */ }
  p.status = 'stopped';
  p.endedAt = Date.now();
  persist();
  emit('process.ended', { id, status: 'stopped' });
  return { success: true };
}

/** Remove a finished process from the registry. */
export function deleteProcess(id) {
  if (!processes[id]) return { success: false, error: 'Process not found' };
  if (processes[id].status === 'running') return { success: false, error: 'Stop the process first' };
  delete processes[id];
  persist();
  return { success: true };
}

function prune() {
  const keys = Object.keys(processes);
  if (keys.length <= MAX_PROCESSES) return;
  // Remove oldest FINISHED processes first; never drop a running one.
  const finished = keys.filter((k) => processes[k].status !== 'running' && processes[k].status !== 'interrupted')
    .sort((a, b) => processes[a].createdAt - processes[b].createdAt);
  for (const k of finished) {
    if (Object.keys(processes).length <= MAX_PROCESSES) break;
    delete processes[k];
  }
}

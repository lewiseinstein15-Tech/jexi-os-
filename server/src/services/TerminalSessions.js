/**
 * B134 — TERMINAL SESSIONS (DeepSeek Harness `packages/terminal/tool-terminal`
 * mirror).
 *
 * Persistent, owner-isolated terminal sessions: terminal_open creates a
 * shell session whose state survives across tool calls (unlike one-shot
 * bash); terminal_send writes stdin, terminal_read drains output,
 * terminal_signal interrupts, terminal_close ends it, terminal_list shows
 * live sessions. Bounded (8 sessions, 200KB buffer each).
 */

import { spawn } from 'child_process';
import crypto from 'crypto';
import { WORKSPACE_DIR } from '../config.js';

const MAX_SESSIONS = 8;
const MAX_BUFFER = 200 * 1024;

const sessions = new Map(); // id → { id, name, child, buffer, closed }

export function terminalOpen({ type = 'shell', name = null, cwd = null } = {}) {
  if (String(type || '') !== 'shell') return { ok: false, error: 'only the "shell" backend type is supported' };
  if (sessions.size >= MAX_SESSIONS) return { ok: false, error: `too many terminal sessions (max ${MAX_SESSIONS}) — close one first` };
  const id = `term-${crypto.randomUUID().slice(0, 12)}`;
  let child;
  try {
    child = spawn(process.env.SHELL || '/bin/bash', ['-i'], {
      cwd: String(cwd || WORKSPACE_DIR || process.cwd()),
      env: { ...process.env, TERM: 'dumb' },
    });
  } catch (e) {
    return { ok: false, error: `failed to spawn shell: ${(e && e.message) || e}` };
  }
  const rec = { id, name: String(name || 'main').slice(0, 40), child, buffer: '', closed: false, motd: `terminal session ${id} ready (${String(name || 'main')})` };
  child.stdout.on('data', (d) => { rec.buffer = (rec.buffer + d.toString('utf8')).slice(-MAX_BUFFER); });
  child.stderr.on('data', (d) => { rec.buffer = (rec.buffer + d.toString('utf8')).slice(-MAX_BUFFER); });
  child.on('exit', () => { rec.closed = true; });
  sessions.set(id, rec);
  return { ok: true, sessionId: id, name: rec.name, motd: rec.motd };
}

function find(id) {
  const rec = sessions.get(String(id || ''));
  return rec || null;
}

export function terminalSend(sessionId, input) {
  const rec = find(sessionId);
  if (!rec) return { ok: false, error: 'terminal session not found' };
  if (rec.closed) return { ok: false, error: 'terminal session has exited' };
  try { rec.child.stdin.write(String(input || '') + '\n'); } catch (e) { return { ok: false, error: `write failed: ${(e && e.message) || e}` }; }
  return { ok: true, sessionId, status: 'running' };
}

export function terminalRead(sessionId, { cap = 12000 } = {}) {
  const rec = find(sessionId);
  if (!rec) return { ok: false, error: 'terminal session not found' };
  const out = rec.buffer.slice(-Math.max(1000, Number(cap) || 12000));
  rec.buffer = ''; // drain
  return { ok: true, sessionId, output: out, status: rec.closed ? 'exited' : 'running' };
}

export function terminalSignal(sessionId, signal = 'SIGINT') {
  const rec = find(sessionId);
  if (!rec) return { ok: false, error: 'terminal session not found' };
  if (rec.closed) return { ok: true, sessionId, accepted: true, status: 'exited', note: 'session already exited' };
  try { rec.child.kill(String(signal || 'SIGINT')); } catch { /* noop */ }
  return { ok: true, sessionId, accepted: true, status: 'running' };
}

export function terminalClose(sessionId) {
  const rec = find(sessionId);
  if (!rec) return { ok: false, error: 'terminal session not found' };
  try { rec.child.kill('SIGTERM'); } catch { /* noop */ }
  rec.closed = true;
  sessions.delete(sessionId);
  return { ok: true, sessionId, closed: true };
}

export function terminalList() {
  return [...sessions.values()].map((r) => ({ sessionId: r.id, name: r.name, status: r.closed ? 'exited' : 'running', bufferedChars: r.buffer.length }));
}

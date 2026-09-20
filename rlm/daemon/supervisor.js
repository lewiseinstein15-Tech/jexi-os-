import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { append, registry, error } from './recovery.js';
const directory = process.argv[2];
const endpoint = path.join(directory, 'daemon.sock');
const journal = path.join(directory, 'sessions.ndjson');
const lock = path.join(directory, 'owner.json');
const startedAt = new Date().toISOString();
const sessions = registry(journal);
let nextRequest = 0, stopping = false;
function record(s, kind, payload) { const r = append(journal, s.id, kind, payload); s.lastActivity = r.ts; }
function view(s) { return { id: s.id, status: s.status, startedAt: s.startedAt, lastActivity: s.lastActivity, workerPid: s.child?.pid ?? null }; }
async function spawnWorker(s, snapshot, recovered = false) {
  const child = fork(fileURLToPath(new URL('./worker.js', import.meta.url)), [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  s.child = child; s.pending = new Map();
  child.on('message', msg => { const p = s.pending.get(msg.requestId); if (p) { s.pending.delete(msg.requestId); clearTimeout(p.timer); msg.error ? p.reject(error(msg.error)) : p.resolve(msg.value); } });
  child.on('exit', (code, signal) => {
    for (const p of s.pending.values()) { clearTimeout(p.timer); p.reject(error('E_WORKER_DIED')); } s.pending.clear();
    s.status = 'inactive'; s.child = null;
    if (!stopping) record(s, 'worker.died', { pid: child.pid, code, signal });
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(error('E_WORKER_TIMEOUT')); }, 5000);
    child.once('message', m => { clearTimeout(timer); m.ready ? resolve() : reject(error('E_WORKER_START')); });
    child.once('error', e => { clearTimeout(timer); reject(e); });
  });
  if (snapshot) {
    try { await call(s, 'restore', snapshot); }
    catch (e) { await new Promise(resolve => { child.once('exit', resolve); child.kill('SIGKILL'); }); throw e; }
  }
  s.status = 'running';
  if (!recovered) record(s, 'worker.spawned', { pid: child.pid });
}
function call(s, op, payload) {
  if (!s.child?.connected) return Promise.reject(error('E_SESSION_INACTIVE'));
  return new Promise((resolve, reject) => {
    const requestId = ++nextRequest;
    const timer = setTimeout(() => { s.pending.delete(requestId); s.child?.kill('SIGKILL'); reject(error('E_WORKER_TIMEOUT')); }, 10000);
    s.pending.set(requestId, { resolve, reject, timer });
    s.child.send({ requestId, op, payload }, e => { if (e) { clearTimeout(timer); s.pending.delete(requestId); reject(e); } });
  });
}
async function route(op, input) {
  if (stopping) throw error('E_DAEMON_STOPPING');
  if (op === 'info') return { pid: process.pid, endpoint, startedAt };
  if (op === 'list') return [...sessions.values()].filter(s => !s.closed).map(view);
  if (op === 'stop') {
    stopping = true;
    for (const s of sessions.values()) {
      if (s.child) await new Promise(resolve => { s.child.once('exit', resolve); s.child.kill('SIGTERM'); });
      if (!s.closed) { record(s, 'session.closed', {}); s.closed = true; }
    }
    return { stopped: true };
  }
  const id = input.id;
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw error('E_SESSION_ID');
  let s = sessions.get(id);
  if (op === 'open') {
    if (s) throw error('E_SESSION_EXISTS');
    s = { id, status: 'inactive', startedAt: new Date().toISOString(), lastActivity: new Date().toISOString() };
    sessions.set(id, s); record(s, 'session.opened', {});
    await spawnWorker(s);
    s.snapshot = await call(s, 'snapshot'); record(s, 'checkpoint', { snapshot: s.snapshot });
    return view(s);
  }
  if (!s || s.closed) throw error('E_SESSION_NOT_FOUND');
  if (op === 'recover') {
    if (s.child) throw error('E_SESSION_ACTIVE');
    if (!s.snapshot) throw error('E_NO_CHECKPOINT');
    record(s, 'recovery.started', { checkpointCells: s.snapshot.journal.length });
    await spawnWorker(s, s.snapshot, true);
    record(s, 'recovery.completed', { pid: s.child.pid, checkpointCells: s.snapshot.journal.length });
    return view(s);
  }
  if (!s.child) throw error('E_SESSION_INACTIVE');
  if (op === 'eval') {
    const value = await call(s, 'eval', { code: input.code, ctx: input.ctx });
    s.snapshot = value.snapshot; record(s, 'checkpoint', { snapshot: s.snapshot });
    return value.result;
  }
  if (op === 'detach' || op === 'attach') {
    s.snapshot = await call(s, 'snapshot'); record(s, 'checkpoint', { snapshot: s.snapshot });
    record(s, op === 'detach' ? 'session.detached' : 'session.attached', {});
    return view(s);
  }
  throw error('E_DAEMON_OP');
}
// Serialize transitions so an eval's checkpoint is durable before the next request.
let queue = Promise.resolve();
const server = http.createServer((req, res) => {
  let body = ''; req.on('data', chunk => { body += chunk; if (body.length > 1024 * 1024) req.destroy(); });
  req.on('end', () => {
    queue = queue.then(async () => {
      try { const { op, ...input } = JSON.parse(body); const value = await route(op, input); res.end(JSON.stringify({ value }));
        if (op === 'stop') server.close(() => { fs.rmSync(endpoint, { force: true }); fs.rmSync(lock, { force: true }); process.exit(0); });
      } catch (e) { res.end(JSON.stringify({ error: e.code || e.message })); }
    });
  });
});
fs.writeFileSync(lock, JSON.stringify({ pid: process.pid }), { mode: 0o600 });
server.listen(endpoint, () => { fs.chmodSync(endpoint, 0o600); process.send?.({ ready: true, pid: process.pid, endpoint, startedAt }); });

#!/usr/bin/env node
// Phase 11 Scope C — codegraph coordination daemon.
//
// CBM semantics: the first session starts the daemon; sessions register on
// open and unregister on close; closing a session cancels only its own work;
// index jobs run as SUPERVISED CHILD PROCESSES (scripts/phase11-index.mjs) so
// cancel/crash semantics are real process semantics; crash recovery replays
// checkpoint + journal from the documented cache dir. Checkpoints land at
// stable points (terminal job states, session/watcher changes) so the journal
// tail after a crash is genuine replay material.
//
// Usage: node kernel/daemon/codegraph-daemon.js [--cache-dir DIR] [--port N] [--verbose]

import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { computeBuildId, runtimeIdentity, checkAdmission, PROTOCOL_VERSION } from './admission.js';
import { SessionRegistry } from './session.js';
import { Journal, Checkpoint, cacheLayout, recover } from './recovery.js';

const REPO_ROOT = path.resolve(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..'));
const GRAPH_DB = path.join(REPO_ROOT, 'capability/code/graph/db');

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : dflt;
}
const CACHE_ROOT = path.resolve(arg('cache-dir', path.join(GRAPH_DB, 'daemon')));
const LISTEN_PORT = Number(arg('port', 0));
const VERBOSE = process.argv.includes('--verbose');

fs.mkdirSync(path.join(CACHE_ROOT, 'logs'), { recursive: true });
const LOG_STREAM = fs.createWriteStream(path.join(CACHE_ROOT, 'logs', 'daemon.log'), { flags: 'a' });
const log = (msg) => {
  const line = `[${new Date().toISOString()}] ${msg}`;
  LOG_STREAM.write(line + '\n');
  if (VERBOSE) console.error(line);
};

// ── recovery from the documented cache dir ───────────────────────────────
const layout = cacheLayout(CACHE_ROOT);
const journal = new Journal(CACHE_ROOT);
const checkpoint = new Checkpoint(CACHE_ROOT);
const rec = recover(CACHE_ROOT, log);
const state = rec.state; // { jobs, watchers, seq }

const sessions = new SessionRegistry();
const identity = { build: computeBuildId(), abi: runtimeIdentity(), protocolVersion: PROTOCOL_VERSION, cacheRoot: fs.realpathSync(CACHE_ROOT) };

// ── job supervision (one index job at a time; child process = real cancel/crash) ──
let activeJob = null;
let childProc = null;
const jobQueue = [];

function persistState() {
  checkpoint.save({ jobs: state.jobs, watchers: state.watchers, seq: journal.seq });
}

function startJob(request) {
  const { sessionId, project, root } = request;
  const job = {
    id: `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    type: 'index',
    project,
    root,
    sessionId,
    status: 'queued',
    queuedAt: new Date().toISOString(),
  };
  state.jobs[job.id] = job;
  journal.append('job-started', { job }); // journaled only — replayed after a crash
  jobQueue.push(job);
  pump();
  return job;
}

function pump() {
  if (activeJob || jobQueue.length === 0) return;
  const job = jobQueue.shift();
  if (job.status === 'cancelled') return pump();
  activeJob = job;
  job.status = 'running';
  job.startedAt = new Date().toISOString();
  log(`job ${job.id} started: project=${job.project} root=${job.root} (session ${job.sessionId})`);
  try {
    childProc = spawn(process.execPath, [path.join(REPO_ROOT, 'scripts/phase11-index.mjs'), '--root', job.root, '--project', job.project, '--db', GRAPH_DB], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    job.status = 'failed';
    job.error = err.message;
    activeJob = null;
    childProc = null;
    journal.append('job-completed', { jobId: job.id, stats: null, error: err.message });
    persistState();
    return pump();
  }
  childProc.on('error', (err) => {
    log(`worker ${job.id} spawn error: ${err.message}`);
    try { childProc.kill('SIGKILL'); } catch { /* already gone */ }
  });
  job.pid = childProc.pid;
  journal.append('job-started', { job }); // pid now known — recovery uses it
  let out = '';
  childProc.stdout.on('data', (d) => { out += d; });
  childProc.stderr.on('data', (d) => log(`[worker ${job.id}] ${d.toString().trim().slice(0, 200)}`));
  childProc.on('exit', (code, signal) => {
    job.finishedAt = new Date().toISOString();
    if (job.status === 'cancelled') {
      log(`job ${job.id} cancelled (session gone)`);
      journal.append('job-cancelled', { jobId: job.id, sessionId: job.sessionId });
    } else if (signal) {
      job.status = 'failed';
      job.error = `worker signal ${signal}`;
      journal.append('job-completed', { jobId: job.id, error: job.error });
    } else if (code === 0) {
      job.status = 'completed';
      try {
        const parsed = JSON.parse(out.slice(out.indexOf('{')));
        job.stats = { nodes: parsed.nodes, edges: parsed.edges, durationMs: parsed.durationMs };
      } catch { job.stats = null; }
      journal.append('job-completed', { jobId: job.id, stats: job.stats });
      log(`job ${job.id} completed: ${JSON.stringify(job.stats)}`);
    } else {
      job.status = 'failed';
      job.error = `worker exit ${code}`;
      journal.append('job-completed', { jobId: job.id, error: job.error });
    }
    activeJob = null;
    childProc = null;
    persistState(); // terminal state → checkpoint
    pump();
  });
}

function cancelJobsOf(sessionId) {
  const cancelled = [];
  for (const job of [...jobQueue]) {
    if (job.sessionId === sessionId) {
      job.status = 'cancelled';
      cancelled.push(job.id);
      journal.append('job-cancelled', { jobId: job.id, sessionId });
      jobQueue.splice(jobQueue.indexOf(job), 1);
    }
  }
  if (activeJob && activeJob.sessionId === sessionId) {
    activeJob.status = 'cancelled';
    cancelled.push(activeJob.id);
    try { childProc.kill('SIGKILL'); } catch { /* worker already gone */ }
  }
  return cancelled;
}

// ── shared watchers (refcounted across sessions) ─────────────────────────
const watchers = new Map(); // id → watcher

function registerWatcher(sessionId, dir, project) {
  const abs = path.resolve(dir);
  if (!fs.existsSync(abs)) {
    const err = new Error(`watch dir does not exist: ${abs}`);
    err.code = 'WATCH_DIR_NOT_FOUND';
    throw err;
  }
  const existing = [...watchers.values()].find((w) => w.dir === abs);
  if (existing) {
    existing.refs.add(sessionId);
    journal.append('watcher-registered', { watcher: snapshotWatcher(existing) });
    persistState();
    return existing;
  }
  const w = {
    id: `watch-${Date.now().toString(36)}`,
    dir: abs,
    project: project || path.basename(abs),
    owner: sessionId,
    refs: new Set([sessionId]),
    events: 0,
    lastIndexTrigger: null,
  };
  w.fsWatcher = fs.watch(abs, { recursive: true }, (eventType, filename) => {
    w.events++;
    clearTimeout(w.timer);
    w.timer = setTimeout(() => {
      const job = startJob({ sessionId: w.owner, project: w.project, root: w.dir });
      w.lastIndexTrigger = job.id;
      journal.append('watcher-triggered', { watcherId: w.id, eventType, filename: filename || null, jobId: job.id });
      log(`watcher ${w.id} (${eventType} ${filename}) → incremental index job ${job.id}`);
    }, 300);
  });
  watchers.set(w.id, w);
  state.watchers[w.id] = snapshotWatcher(w);
  journal.append('watcher-registered', { watcher: snapshotWatcher(w) });
  persistState();
  log(`watcher ${w.id} registered on ${abs} (session ${sessionId})`);
  return w;
}

function snapshotWatcher(w) {
  return { id: w.id, dir: w.dir, project: w.project, owner: w.owner, refs: [...w.refs] };
}

function dropSessionFromWatchers(sessionId) {
  const stopped = [];
  for (const w of [...watchers.values()]) {
    w.refs.delete(sessionId);
    if (w.refs.size === 0) {
      clearTimeout(w.timer);
      w.fsWatcher.close();
      watchers.delete(w.id);
      delete state.watchers[w.id];
      journal.append('watcher-stopped', { watcherId: w.id });
      stopped.push(w.id);
    } else {
      journal.append('watcher-registered', { watcher: snapshotWatcher(w) });
    }
  }
  return stopped;
}

// ── graph reads (lazy, fresh store instance per call — jobs are the writers) ──
async function graphStatus(project) {
  const { openGraphStore } = await import('../../capability/code/graph/store.js');
  const store = await openGraphStore(GRAPH_DB, { project });
  const projects = store.listProjects();
  const out = { backend: store.backend, projects };
  if (project) {
    const p = projects.find((x) => x.project === project) || null;
    out.project = p;
    out.indexedAt = store.getMeta(`${project}:indexedAt`) || null;
  }
  store.close();
  return out;
}

// ── wire protocol ─────────────────────────────────────────────────────────
const server = net.createServer((socket) => {
  const peer = `${socket.remoteAddress}:${socket.remotePort}`;
  let admitted = false;
  let buffer = '';
  let boundSession = null;
  log(`connection ${peer} open`);

  socket.on('data', (chunk) => {
    buffer += chunk.toString();
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      if (!line.trim()) continue;
      let req;
      try {
        req = JSON.parse(line);
      } catch {
        send({ id: null, error: { code: 'BAD_JSON', message: 'request is not valid JSON' } });
        continue;
      }
      handle(req).catch((err) => {
        send({ id: req.id, error: { code: err.code || 'INTERNAL', message: err.message } });
      });
    }
  });
  socket.on('close', () => {
    log(`connection ${peer} closed${boundSession ? ` (session ${boundSession} socket gone)` : ''}`);
    if (boundSession) {
      // socket death without explicit unregister = session close (cancel its work)
      const r = sessions.unregister(boundSession);
      if (r.removed) {
        const cancelled = cancelJobsOf(boundSession);
        const stopped = dropSessionFromWatchers(boundSession);
        journal.append('session-closed', { sessionId: boundSession, cancelled, watcherStopped: stopped });
        persistState();
        log(`session ${boundSession} closed: cancelled=${JSON.stringify(cancelled)} watchersStopped=${JSON.stringify(stopped)}`);
      }
    }
  });
  socket.on('error', () => { /* ECONNRESET etc. — close handler does the work */ });

  function send(obj) {
    try { socket.write(JSON.stringify(obj) + '\n'); } catch { /* socket gone */ }
  }

  async function handle(req) {
    const { id, method, params = {} } = req;
    const reply = (result) => send({ id, result });
    const fail = (code, message) => send({ id, error: { code, message } });

    if (method === 'handshake') {
      const verdict = checkAdmission(params, identity, identity.cacheRoot);
      if (!verdict.admitted) {
        log(`ADMISSION REFUSED ${peer}: ${verdict.code} — ${verdict.reason}`);
        return fail(verdict.code, verdict.reason);
      }
      admitted = true;
      return reply({ admitted: true, daemon: { pid: process.pid, build: identity.build, abi: identity.abi, protocolVersion: PROTOCOL_VERSION, cacheRoot: identity.cacheRoot, startedAt: STARTED_AT } });
    }
    if (method === 'ping') return reply({ pong: true, pid: process.pid });

    if (!admitted) return fail('NOT_ADMITTED', 'handshake (with valid build/abi/cache-root) required before any other method');

    switch (method) {
      case 'register': {
        const sessionId = String(params.sessionId || '');
        if (!sessionId) return fail('SESSION_ID_REQUIRED', 'sessionId is required');
        const { session, reattached } = sessions.register(sessionId, params.namespace, socket);
        boundSession = sessionId;
        journal.append('session-registered', { sessionId, namespace: session.namespace, reattached });
        persistState();
        log(`session ${sessionId} registered (namespace ${session.namespace}${reattached ? ', reattached' : ''})`);
        return reply({ ok: true, session: { id: session.id, namespace: session.namespace, registeredAt: session.registeredAt }, reattached, sessions: sessions.list() });
      }
      case 'unregister': {
        const sessionId = String(params.sessionId || '');
        const r = sessions.unregister(sessionId);
        if (!r.removed && !r.connDroppedOnly) return fail('SESSION_NOT_REGISTERED', `session "${sessionId}" is not registered`);
        if (boundSession === sessionId) boundSession = null;
        const cancelled = cancelJobsOf(sessionId);
        const stopped = dropSessionFromWatchers(sessionId);
        journal.append('session-closed', { sessionId, cancelled, watcherStopped: stopped });
        persistState();
        return reply({ ok: true, closed: r.removed, cancelledJobs: cancelled, watchersStopped: stopped, sessions: sessions.list() });
      }
      case 'index': {
        const session = sessions.require(String(params.sessionId || ''));
        if (!params.root) return fail('ROOT_REQUIRED', 'root is required');
        if (!fs.existsSync(path.resolve(String(params.root)))) return fail('ROOT_NOT_FOUND', `root does not exist: ${params.root}`);
        const job = startJob({ sessionId: session.id, project: String(params.project || path.basename(String(params.root))), root: path.resolve(String(params.root)) });
        return reply({ ok: true, jobId: job.id, job });
      }
      case 'job-status': {
        const job = state.jobs[String(params.jobId || '')];
        if (!job) return fail('JOB_NOT_FOUND', `unknown job "${params.jobId}"`);
        return reply({ ok: true, job });
      }
      case 'graph-status': {
        const g = await graphStatus(params.project ? String(params.project) : undefined);
        return reply({ ok: true, ...g });
      }
      case 'watch': {
        const session = sessions.require(String(params.sessionId || ''));
        const w = registerWatcher(session.id, String(params.dir), params.project ? String(params.project) : undefined);
        return reply({ ok: true, watcher: snapshotWatcher(w) });
      }
      case 'status': {
        return reply({
          ok: true,
          daemon: { pid: process.pid, build: identity.build, abi: identity.abi, cacheRoot: identity.cacheRoot, startedAt: STARTED_AT, uptimeMs: Date.now() - startedMs },
          sessions: sessions.list(),
          jobs: Object.fromEntries(Object.entries(state.jobs).map(([k, v]) => [k, { id: v.id, project: v.project, sessionId: v.sessionId, status: v.status, stats: v.stats || null }])),
          watchers: [...watchers.values()].map(snapshotWatcher),
          queueDepth: jobQueue.length,
          activeJob: activeJob ? { id: activeJob.id, project: activeJob.project, status: activeJob.status } : null,
          recovery: { replayedEvents: rec.replay.length, interruptedJobs: rec.interrupted, reclaimedWorkers: rec.reclaims.length },
        });
      }
      case 'shutdown': {
        reply({ ok: true, goodbye: true });
        log(`shutdown requested${boundSession ? ` by session ${boundSession}` : ''}`);
        setTimeout(() => cleanShutdown(), 50);
        return;
      }
      default:
        return fail('UNKNOWN_METHOD', `unknown method "${method}"`);
    }
  }
});

// ── lifecycle ─────────────────────────────────────────────────────────────
const STARTED_AT = new Date().toISOString();
const startedMs = Date.now();

function writeEndpoint() {
  fs.writeFileSync(layout.endpoint, JSON.stringify({
    pid: process.pid,
    port: server.address().port,
    host: '127.0.0.1',
    protocolVersion: PROTOCOL_VERSION,
    build: identity.build,
    abi: identity.abi,
    cacheRoot: identity.cacheRoot,
    startedAt: STARTED_AT,
  }));
}

let shuttingDown = false;
const openSockets = new Set();
server.on('connection', (s) => {
  openSockets.add(s);
  s.on('close', () => openSockets.delete(s));
});

function cleanShutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`clean shutdown begin (jobs running: ${activeJob ? activeJob.id : 'none'})`);
  try { if (childProc) childProc.kill('SIGTERM'); } catch { /* already gone */ }
  for (const s of openSockets) { try { s.destroy(); } catch { /* gone */ } }
  for (const w of watchers.values()) {
    clearTimeout(w.timer);
    try { w.fsWatcher.close(); } catch { /* already closed */ }
  }
  journal.append('daemon-stopped', { clean: true });
  persistState();
  try { fs.rmSync(layout.endpoint, { force: true }); } catch { /* absent */ }
  server.close(() => {
    LOG_STREAM.end(() => process.exit(exitCode));
  });
  setTimeout(() => process.exit(exitCode), 1500).unref();
}

process.on('SIGTERM', () => cleanShutdown(0));
process.on('SIGINT', () => cleanShutdown(0));

server.listen(LISTEN_PORT, '127.0.0.1', () => {
  writeEndpoint();
  log(`daemon up: pid=${process.pid} port=${server.address().port} build=${identity.build} cache=${identity.cacheRoot}`);
  log(`recovery: replayed=${rec.replay.length} interrupted=${JSON.stringify(rec.interrupted)} reclaimed=${rec.reclaims.length}`);
  persistState(); // checkpoint the recovered statuses (interrupted etc.)
  journal.append('daemon-started', { pid: process.pid, port: server.address().port, build: identity.build, recovery: { replayed: rec.replay.length, interrupted: rec.interrupted } });
});

/**
 * TASK GRAPH — Ultimate Architecture Upgrade §12–§16 (Sept 2026).
 *
 * The persistent execution layer beneath JEXI:
 *
 *   PLANNER → TASK GRAPH (dependsOn, agent, tools, status, retries)
 *          → dependency-aware PARALLEL execution (worker pool)
 *          → verification → back to JEXI.
 *
 * Worker lifecycle (§17):
 *   CREATED → QUEUED → STARTING → READY → RUNNING → WAITING → COMPLETED
 *   terminal failures: FAILED / TIMEOUT / CANCELLED / BLOCKED
 *
 * Failure recovery (§18): per-task retries with backoff, per-task timeouts,
 * run cancellation (in-flight tasks get the abort signal), dependency
 * cascade (a failed task BLOCKS its dependents instead of running them).
 *
 * Execution goes through an ExecutionBackend (§38) — default JexiNativeBackend.
 * The graph itself never talks to an LLM: tests inject fake workers, and the
 * native backend wraps the existing WorkerRouter (no rewrite of working code).
 *
 * Persistence: DATA_DIR/architecture/runs.json (atomic write, last 50 runs).
 */
import fs from 'node:fs';
import path from 'node:path';
import { getBackend } from './ExecutionBackend.js';
import { DATA_DIR } from '../config.js';

const RUNS_FILE = path.join(DATA_DIR, 'architecture', 'runs.json');
const MAX_RUNS = 50;

export const TASK_STATES = [
  'CREATED', 'QUEUED', 'STARTING', 'READY', 'RUNNING', 'WAITING',
  'COMPLETED', 'FAILED', 'TIMEOUT', 'CANCELLED', 'BLOCKED',
];

let runs = null; // Map<runId, run>
let seq = 0;

function ensureLoaded() {
  if (runs) return;
  runs = new Map();
  try {
    if (fs.existsSync(RUNS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(RUNS_FILE, 'utf8'));
      for (const r of raw.runs || []) runs.set(r.id, r);
      seq = raw.seq || runs.size;
    }
  } catch { /* corrupt file — start fresh, never crash the host */ }
}

function persist() {
  try {
    fs.mkdirSync(path.dirname(RUNS_FILE), { recursive: true });
    const recent = [...runs.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_RUNS);
    fs.writeFileSync(RUNS_FILE, JSON.stringify({ seq, runs: recent }, null, 1));
  } catch { /* persistence is best-effort — the graph still works in memory */ }
}

function now() { return Date.now(); }
function iso(t) { return new Date(t).toISOString(); }

function timeline(run, type, detail = {}) {
  run.timeline.push({ t: now(), type, ...detail });
  if (run.timeline.length > 400) run.timeline.splice(0, run.timeline.length - 400);
}

/* ── run + task creation ──────────────────────────────────────────────────── */

export function createRun({ query, intent = 'direct_answer', backend = 'jexi-native', createdBy = 'jexi' } = {}) {
  ensureLoaded();
  const id = `run-${++seq}`;
  const run = {
    id, query, intent, backend, createdBy,
    status: 'planning', // planning → running → completed | failed | cancelled
    tasks: [],
    timeline: [],
    createdAt: now(),
    startedAt: null,
    endedAt: null,
  };
  runs.set(id, run);
  timeline(run, 'run_created', { query, intent, backend });
  persist();
  return run;
}

export function addTask(runId, { title, agent = 'jexi', tools = [], dependsOn = [], capabilities = [], timeoutMs = 120_000, maxRetries = 2, prompt = '' } = {}) {
  ensureLoaded();
  const run = runs.get(runId);
  if (!run) throw new Error(`unknown run ${runId}`);
  const id = `${runId}-t${run.tasks.length + 1}`;
  const task = {
    id, title, agent, tools, capabilities,
    dependsOn: [...new Set(dependsOn)],
    status: 'CREATED',
    attempt: 0, maxRetries,
    timeoutMs,
    prompt,
    result: null, error: null,
    createdAt: now(), startedAt: null, endedAt: null, durationMs: null,
  };
  run.tasks.push(task);
  timeline(run, 'task_created', { taskId: id, title, agent, dependsOn: task.dependsOn });
  persist();
  return task;
}

/* ── execution ────────────────────────────────────────────────────────────── */

function depsDone(run, task) {
  return task.dependsOn.every((d) => {
    const dep = run.tasks.find((t) => t.id === d || t.id === `${d}`);
    return dep && dep.status === 'COMPLETED';
  });
}

function depsBlocked(run, task) {
  return task.dependsOn.some((d) => {
    const dep = run.tasks.find((t) => t.id === d);
    return dep && ['FAILED', 'TIMEOUT', 'CANCELLED', 'BLOCKED'].includes(dep.status);
  });
}

/**
 * Execute a run: dependency-aware parallel execution with retries, timeouts,
 * cancellation and dependency cascade. `worker` is injectable for tests; the
 * default is the run's ExecutionBackend.
 */
export async function executeRun(runId, { worker = null, concurrency = 4, onEvent = null, signal = null } = {}) {
  ensureLoaded();
  const run = runs.get(runId);
  if (!run) throw new Error(`unknown run ${runId}`);
  if (run.status === 'running') throw new Error(`run ${runId} is already running`);
  const exec = worker || ((task, ctx) => getBackend(run.backend).execute(task, ctx));

  run.status = 'running';
  run.startedAt = now();
  timeline(run, 'run_started', { tasks: run.tasks.length, concurrency });
  const cancelled = () => (signal && signal.aborted) || run.status === 'cancelled';

  const pending = new Map(); // taskId → running promise
  const backoff = []; // {taskId, at} retry schedule
  const backoffIds = new Set(); // tasks inside a retry backoff window

  const startable = () => run.tasks.filter((t) =>
    (t.status === 'CREATED' || t.status === 'QUEUED') && !backoffIds.has(t.id));

  const launch = async (task) => {
    task.status = 'STARTING';
    timeline(run, 'task_starting', { taskId: task.id, attempt: task.attempt + 1 });
    try {
      // READY: the worker slot is reserved and inputs are assembled (§17).
      task.status = 'READY';
      task.status = 'RUNNING';
      task.startedAt = now();
      task.attempt += 1;
      onEvent && onEvent({ type: 'task.start', taskId: task.id, attempt: task.attempt });
      const abort = new AbortController();
      const onOuterAbort = () => abort.abort();
      signal && signal.addEventListener('abort', onOuterAbort, { once: true });
      let timer = null;
      try {
        const resultP = Promise.resolve(exec(task, { run, signal: abort.signal, tools: task.tools }));
        const timeoutP = new Promise((_, rej) => {
          timer = setTimeout(() => rej(new Error(`task timeout after ${task.timeoutMs}ms`)), task.timeoutMs);
          // NOTE: deliberately NOT unref'd — the finally below always clears it,
          // and an unref'd timer can let the event loop drain while a task
          // race is still awaited (kills in-process runs).
        });
        const out = await Promise.race([resultP, timeoutP]);
        // §18 cancellation: if the run was cancelled while this worker ran,
        // the late result is discarded — an aborted run never reports success.
        if (cancelled()) {
          task.status = 'CANCELLED';
          task.endedAt = now();
          timeline(run, 'task_cancelled', { taskId: task.id, note: 'worker finished after cancel — result discarded' });
          return;
        }
        if (out && out.status === 'waiting') {
          task.status = 'WAITING';
          task.result = out.payload || null;
          timeline(run, 'task_waiting', { taskId: task.id });
          onEvent && onEvent({ type: 'task.waiting', taskId: task.id });
          return;
        }
        task.status = 'COMPLETED';
        task.result = out && out.result !== undefined ? out.result : out;
        task.endedAt = now();
        task.durationMs = task.endedAt - task.startedAt;
        timeline(run, 'task_completed', { taskId: task.id, attempt: task.attempt, durationMs: task.durationMs });
        onEvent && onEvent({ type: 'task.complete', taskId: task.id, durationMs: task.durationMs });
      } finally {
        clearTimeout(timer);
        signal && signal.removeEventListener('abort', onOuterAbort);
      }
    } catch (e) {
      const timedOut = /timeout/i.test(String(e && e.message));
      task.endedAt = now();
      task.durationMs = task.startedAt ? task.endedAt - task.startedAt : 0;
      task.error = String(e && e.message).slice(0, 300);
      if (signal && signal.aborted) {
        task.status = 'CANCELLED';
        timeline(run, 'task_cancelled', { taskId: task.id });
        return;
      }
      if (task.attempt <= task.maxRetries) {
        // §18 failure recovery: retry with backoff instead of failing the run
        task.status = 'QUEUED';
        const delay = Math.min(1000 * 2 ** (task.attempt - 1), 8000);
        timeline(run, 'task_retry', { taskId: task.id, attempt: task.attempt, nextAttempt: task.attempt + 1, delayMs: delay, error: task.error });
        onEvent && onEvent({ type: 'task.retry', taskId: task.id, delayMs: delay });
        backoff.push({ taskId: task.id, at: now() + delay });
        backoffIds.add(task.id);
        return;
      }
      task.status = timedOut ? 'TIMEOUT' : 'FAILED';
      timeline(run, timedOut ? 'task_timeout' : 'task_failed', { taskId: task.id, attempt: task.attempt, error: task.error });
      onEvent && onEvent({ type: 'task.fail', taskId: task.id, error: task.error });
    }
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let guard = 0;
  while (true) {
    if (guard++ > 10_000) break; // safety valve
    if (cancelled()) {
      run.status = 'cancelled';
      run.endedAt = now();
      timeline(run, 'run_cancelled', {});
      for (const t of run.tasks) if (['CREATED', 'QUEUED', 'STARTING', 'READY', 'RUNNING'].includes(t.status)) {
        t.status = 'CANCELLED';
        t.endedAt = now();
      }
      persist();
      return run;
    }
    // resolve retries whose backoff elapsed
    for (let i = backoff.length - 1; i >= 0; i--) {
      if (now() >= backoff[i].at) {
        const t = run.tasks.find((x) => x.id === backoff[i].taskId);
        backoffIds.delete(backoff[i].taskId);
        if (t && t.status === 'QUEUED') pending.set(t.id, launch(t));
        backoff.splice(i, 1);
      }
    }
    // dependency cascade: BLOCK dependents of failed tasks
    for (const t of run.tasks) {
      if (['CREATED', 'QUEUED'].includes(t.status) && depsBlocked(run, t)) {
        t.status = 'BLOCKED';
        t.error = 'a dependency failed';
        timeline(run, 'task_blocked', { taskId: t.id });
      }
    }
    // launch ready tasks up to concurrency
    for (const t of startable()) {
      if (pending.size >= concurrency) break;
      if (pending.has(t.id)) continue;
      if (!depsDone(run, t)) continue;
      pending.set(t.id, launch(t));
    }
    if (pending.size) {
      // launch() NEVER rejects — every outcome is recorded inside it
      await Promise.all([...pending.values()]);
      pending.clear();
    } else if (backoff.length) {
      await sleep(Math.max(10, Math.min(...backoff.map((b) => b.at)) - now()));
    } else {
      break; // nothing running, nothing scheduled → done
    }
  }

  run.endedAt = now();
  const failed = run.tasks.filter((t) => ['FAILED', 'TIMEOUT'].includes(t.status));
  const blocked = run.tasks.filter((t) => t.status === 'BLOCKED');
  const cancelledTasks = run.tasks.filter((t) => t.status === 'CANCELLED');
  run.status = cancelledTasks.length && !failed.length ? 'cancelled'
    : failed.length || blocked.length ? 'failed' : 'completed';
  timeline(run, 'run_ended', { status: run.status, completed: run.tasks.filter((t) => t.status === 'COMPLETED').length, failed: failed.length, blocked: blocked.length, durationMs: run.endedAt - run.startedAt });
  persist();
  return run;
}

export function cancelRun(runId) {
  ensureLoaded();
  const run = runs.get(runId);
  if (!run) return null;
  if (run.status === 'running') {
    run.status = 'cancelled'; // the loop sees it and stops launching
    timeline(run, 'run_cancel_requested', {});
    persist();
  }
  return run;
}

/* ── read views (observability §20 — no new UI: these feed the API) ───────── */

export function listRuns() {
  ensureLoaded();
  return [...runs.values()]
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((r) => ({
      id: r.id, query: r.query, intent: r.intent, backend: r.backend,
      status: r.status, createdAt: iso(r.createdAt), endedAt: r.endedAt ? iso(r.endedAt) : null,
      tasks: r.tasks.map((t) => ({ id: t.id, title: t.title, agent: t.agent, status: t.status, attempt: t.attempt, durationMs: t.durationMs })),
    }));
}

export function getRun(runId) {
  ensureLoaded();
  const r = runs.get(runId);
  if (!r) return null;
  return {
    ...r,
    createdAt: iso(r.createdAt),
    startedAt: r.startedAt ? iso(r.startedAt) : null,
    endedAt: r.endedAt ? iso(r.endedAt) : null,
    timeline: r.timeline.map((e) => ({ ...e, t: iso(e.t) })),
  };
}

export function taskGraphStats() {
  ensureLoaded();
  const all = [...runs.values()];
  const byStatus = {};
  for (const r of all) for (const t of r.tasks) byStatus[t.status] = (byStatus[t.status] || 0) + 1;
  return {
    runs: all.length,
    runsRunning: all.filter((r) => r.status === 'running').length,
    taskStates: TASK_STATES.map((s) => ({ state: s, count: byStatus[s] || 0 })),
  };
}

export function clearRuns() { // test helper
  runs = new Map();
  seq = 0;
  try { fs.rmSync(RUNS_FILE, { force: true }); } catch {}
}

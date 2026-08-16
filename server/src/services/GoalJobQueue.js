/**
 * JEXI OS — Goal Job Queue (Phase 2: durable background goals).
 *
 * Goals become DURABLE BACKGROUND JOBS instead of work bound to an HTTP
 * response:
 *
 *   - POST /api/goals returns immediately with { jobId } (202-style); the
 *     worker runs the GoalEngine in the background.
 *   - Live progress: GET /api/goals/:id/stream replays the persisted event
 *     log then streams new NDJSON events until the job finishes.
 *   - Restart survival: jobs + their event logs persist to
 *     DATA_DIR/goal-jobs.json. On boot, queued jobs are re-run; running jobs
 *     are honestly marked interrupted (like the ProcessManager); need-info
 *     jobs stay parked and can be answered after a restart.
 *   - One worker at a time (free-tier friendly — the ProviderRateLimiter
 *     already caps LLM concurrency).
 *
 * The executor (default: the shared GoalEngine) is injectable so the queue
 * itself is unit-testable.
 */

import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../config.js';

const FILE = path.join(DATA_DIR, 'goal-jobs.json');
const MAX_EVENTS_PER_JOB = 300;
const MAX_JOBS = 50;

let jobs = load(); // id → record
const listeners = new Map(); // jobId → Set<sendEvent>
let running = null; // current job id
let queueWake = null; // promise resolver to wake the worker

/** @type {{ startGoal: Function, resumeWithInfo: Function }} */
const executor = { startGoal: null, resumeWithInfo: null };

/** Optional terminal-state reporter (GoalNotifier) — injected from index.js. */
let notifier = null;

export function setGoalExecutor(exec) {
  if (exec) {
    if (typeof exec.startGoal === 'function') executor.startGoal = exec.startGoal.bind(exec);
    if (typeof exec.resumeWithInfo === 'function') executor.resumeWithInfo = exec.resumeWithInfo.bind(exec);
  }
}

export function setGoalNotifier(fn) {
  notifier = typeof fn === 'function' ? fn : null;
}

/** Report a terminal job (in-app notification + optional email report). */
function reportTerminal(job) {
  if (notifier) {
    try { notifier(job); } catch { /* never break the worker */ }
  }
}

function load() {
  try {
    if (fs.existsSync(FILE)) {
      const parsed = JSON.parse(fs.readFileSync(FILE, 'utf-8'));
      const now = Date.now();
      for (const j of Object.values(parsed)) {
        // Boot recovery: queued → will re-run; running → interrupted honestly;
        // need-info stays parked (answerable after restart).
        if (j.status === 'running') {
          j.status = 'failed';
          j.error = 'Interrupted by a server restart — re-run the goal.';
          j.endedAt = now;
          j.events = (j.events || []).concat([{ type: 'log', agent: 'Goal Queue', message: '⏹ Interrupted by server restart.' }]).slice(-MAX_EVENTS_PER_JOB);
        }
        if (j.status === 'queued') j.status = 'queued'; // worker picks it up
      }
      return parsed;
    }
  } catch (e) { console.error('[GoalJobs] load error:', e.message); }
  return {};
}

let persistTimer = null;
function persist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(FILE, JSON.stringify(jobs, null, 2), 'utf-8');
    } catch (e) { console.error('[GoalJobs] persist error:', e.message); }
  }, 300);
}

function broadcast(jobId, event) {
  const set = listeners.get(jobId);
  if (set) for (const fn of set) { try { fn(event); } catch { /* noop */ } }
}

function addEvent(job, event) {
  job.events = (job.events || []).concat([event]).slice(-MAX_EVENTS_PER_JOB);
  job.updatedAt = Date.now();
  broadcast(job.id, event);
  persist();
}

function publicJob(j) {
  return {
    id: j.id,
    goal: j.goal,
    session: j.session,
    autonomy: j.autonomy,
    status: j.status, // queued | running | need-info | done | failed
    createdAt: j.createdAt,
    startedAt: j.startedAt,
    endedAt: j.endedAt,
    updatedAt: j.updatedAt,
    infoRequests: j.infoRequests || [],
    autoApprovals: (j.autoApprovals || []).length,
    result: j.result || null,
    error: j.error || null,
    eventCount: (j.events || []).length,
  };
}

/** Enqueue a goal. Returns the job id immediately. */
export function enqueueGoal({ goal, session = 'default', autonomy = 'ask' }) {
  const id = `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  jobs[id] = {
    id,
    goal: String(goal || '').trim(),
    session: String(session || 'default'),
    autonomy: String(autonomy || 'ask').toLowerCase(),
    status: 'queued',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    startedAt: null,
    endedAt: null,
    events: [],
    infoRequests: [],
    autoApprovals: [],
    result: null,
    error: null,
    goalId: null, // set once the GoalEngine creates its record
    pendingAnswer: null,
  };
  // Prune oldest finished jobs.
  const keys = Object.keys(jobs);
  if (keys.length > MAX_JOBS * 2) {
    const order = keys.sort((a, b) => jobs[a].createdAt - jobs[b].createdAt);
    for (const k of order) {
      if (Object.keys(jobs).length <= MAX_JOBS) break;
      const j = jobs[k];
      if (j.status === 'done' || j.status === 'failed') delete jobs[k];
    }
  }
  persist();
  wakeWorker();
  return { id };
}

/** Answer a parked (need-info) job. The worker resumes it. */
export function answerJob(jobId, answer) {
  const j = jobs[jobId];
  if (!j) return { ok: false, error: 'job not found' };
  if (j.status !== 'need-info') return { ok: false, error: `job is not waiting for info (status: ${j.status})` };
  j.pendingAnswer = String(answer || '').slice(0, 4000);
  j.status = 'queued';
  j.updatedAt = Date.now();
  persist();
  wakeWorker();
  return { ok: true, id: jobId };
}

export function getJob(jobId) {
  const j = jobs[jobId];
  return j ? publicJob(j) : null;
}

/** Persisted events for a job (used to recover the final done event). */
export function getJobEvents(jobId) {
  const j = jobs[jobId];
  return j ? (j.events || []) : null;
}

export function listJobs() {
  return Object.values(jobs)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, MAX_JOBS)
    .map(publicJob);
}

/**
 * Subscribe to a job's NDJSON event stream. Replays the persisted log first
 * (unless { replay: false }), then streams live events. Returns an
 * unsubscribe function. Resolves with { ok: false } when the job does not
 * exist, or { ok: true, finished: true } when the job is already terminal.
 */
export function subscribe(jobId, sendEvent, opts = {}) {
  const j = jobs[jobId];
  if (!j) return { ok: false, error: 'job not found' };
  if (opts.replay !== false) {
    for (const e of j.events || []) { try { sendEvent(e); } catch { /* noop */ } }
  }
  if (j.status === 'done' || j.status === 'failed') {
    return { ok: true, finished: true };
  }
  if (!listeners.has(jobId)) listeners.set(jobId, new Set());
  listeners.get(jobId).add(sendEvent);
  return { ok: true, unsubscribe: () => { const s = listeners.get(jobId); if (s) { s.delete(sendEvent); if (!s.size) listeners.delete(jobId); } } };
}

/* ------------------------------------------------------------------ */
/* Worker                                                              */
/* ------------------------------------------------------------------ */

async function wakeWorker() {
  queueWake = queueWake || (async () => {
    await runNext();
    queueWake = null;
  })();
}

async function runNext() {
  while (true) {
    // 1) Pick the next queued job (oldest first, need-info answers included).
    const next = Object.values(jobs)
      .filter((j) => j.status === 'queued')
      .sort((a, b) => a.createdAt - b.createdAt)[0];
    if (!next) return;
    if (running) { /* single worker — wait for the current job */ await sleep(500); continue; }

    running = next.id;
    next.status = 'running';
    next.startedAt = Date.now();
    next.updatedAt = Date.now();
    persist();
    addEvent(next, { type: 'job.started', jobId: next.id });

    try {
      let out;
      if (next.pendingAnswer && next.goalId) {
        addEvent(next, { type: 'goal.resuming', goalId: next.goalId, goal: next.goal });
        out = await executor.resumeWithInfo({
          goalId: next.goalId,
          session: next.session,
          answer: next.pendingAnswer,
          sendEvent: (t, d) => addEvent(next, { type: t, ...d }),
          fallback: { goal: next.goal, autonomy: next.autonomy },
        });
        next.pendingAnswer = null;
      } else {
        out = await executor.startGoal({
          goal: next.goal,
          session: next.session,
          autonomy: next.autonomy,
          sendEvent: (t, d) => addEvent(next, { type: t, ...d }),
        });
      }

      if (out && out.goalId) next.goalId = out.goalId;
      if (out && out.needInfo && out.needInfo.length) {
        next.status = 'need-info';
        next.infoRequests = out.needInfo;
        addEvent(next, { type: 'done', success: true, parked: true, goalId: out.goalId, summary: 'Waiting for your details — answer in chat and I will continue.' });
      } else if (out && out.result) {
        next.status = out.result.success === false ? 'failed' : 'done';
        next.result = out.result;
        next.endedAt = Date.now();
        addEvent(next, {
          type: 'done', success: out.result.success !== false, goalId: out.goalId,
          summary: out.result.summary || (out.result.success === false ? (out.result.error || 'Goal failed.') : '✅ Goal completed.'),
          files: out.result.files || [], sources: out.result.sources || [], statistics: out.result.statistics || {},
        });
        reportTerminal(next);
      } else {
        next.status = 'failed';
        next.error = (out && out.error) || 'goal failed';
        next.endedAt = Date.now();
        addEvent(next, { type: 'done', success: false, summary: `### ⚠ JEXI OS\n\n${next.error}` });
        reportTerminal(next);
      }
    } catch (e) {
      next.status = 'failed';
      next.error = (e && e.message) || String(e);
      next.endedAt = Date.now();
      addEvent(next, { type: 'done', success: false, summary: `### ⚠ JEXI OS\n\n${next.error}` });
      reportTerminal(next);
    } finally {
      running = null;
    }
  }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/** Test helpers. */
export function resetGoalJobs() {
  jobs = {};
  listeners.clear();
  running = null;
}

export function jobCounts() {
  const c = { queued: 0, running: 0, 'need-info': 0, done: 0, failed: 0 };
  for (const j of Object.values(jobs)) c[j.status] = (c[j.status] || 0) + 1;
  return c;
}

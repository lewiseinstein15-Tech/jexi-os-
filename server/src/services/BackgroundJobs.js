/**
 * B106 — BACKGROUND JOBS (mirror of DeepSeek Harness
 * `packages/jobs/jobs-local` + `packages/jobs/tool-jobs`).
 *
 * The model can launch a task that keeps running in the background
 * (`run_in_background`), then collect its result later (`jobs_collect`),
 * list jobs (`job_list`) and stop them (`job_kill`). The executor is
 * injectable (tests); production runs the native agent loop.
 */

const MAX_JOBS = 50;
const MAX_CONCURRENT = 3;
const MAX_ANSWER_CHARS = 12000;

const jobs = new Map(); // id → { id, task, session, status, answer, error, createdAt, startedAt, finishedAt }
let executor = null;
let nextId = 1;

/** Injectable executor (tests inject a mock; index.js wires the real loop). */
export function setJobExecutor(exec) {
  executor = exec && typeof exec.run === 'function' ? exec : null;
}

function newId() {
  const id = `job-${Date.now().toString(36)}-${(nextId++).toString(36)}`;
  return id;
}

/** Start a background job. @returns {{ok:true,id:string,status:string}|{ok:false,error:string}} */
export function startJob({ task, session = 'default', profile = null, signal } = {}) {
  const text = String(task || '').trim();
  if (!text) return { ok: false, error: 'background job needs a task' };
  const running = [...jobs.values()].filter((j) => j.status === 'running' || j.status === 'queued').length;
  if (running >= MAX_CONCURRENT) {
    return { ok: false, error: `too many background jobs running (max ${MAX_CONCURRENT}) — collect or kill one first` };
  }
  const id = newId();
  const job = { id, task: text.slice(0, 3000), session: String(session).slice(0, 80), profile, status: 'queued', answer: null, error: null, createdAt: Date.now(), startedAt: null, finishedAt: null };
  jobs.set(id, job);
  // Cap the store — oldest finished jobs drop first.
  while (jobs.size > MAX_JOBS) {
    const oldest = [...jobs.values()].sort((a, b) => a.createdAt - b.createdAt)[0];
    if (oldest && oldest.status !== 'running' && oldest.status !== 'queued') jobs.delete(oldest.id);
    else break;
  }
  const controller = new AbortController();
  job._controller = controller;
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  runJob(job, controller.signal).catch(() => {});
  return { ok: true, id, status: 'queued' };
}

async function runJob(job, signal) {
  job.status = 'running';
  job.startedAt = Date.now();
  try {
    if (!executor) throw new Error('background executor not wired');
    const out = await executor.run({ task: job.task, session: job.session, profile: job.profile, signal });
    if (signal.aborted) return; // killed — status set by killJob
    job.answer = String((out && (out.answer || out.text)) || '').slice(0, MAX_ANSWER_CHARS);
    job.status = 'finished';
  } catch (e) {
    if (signal.aborted) return;
    job.error = String((e && e.message) || e).slice(0, 500);
    job.status = 'failed';
  } finally {
    job.finishedAt = Date.now();
  }
}

/** Status of one job. */
export function jobStatus(id) {
  const j = jobs.get(String(id || ''));
  if (!j) return null;
  return publicJob(j);
}

/** Collect a finished job's answer (keeps the record for list/export). */
export function collectJob(id) {
  const j = jobs.get(String(id || ''));
  if (!j) return null;
  return publicJob(j);
}

/** List jobs, newest first, bounded. */
export function listJobs(limit = 20) {
  return [...jobs.values()]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, Math.max(1, Number(limit) || 20))
    .map(publicJob);
}

/** Kill a running/queued job. */
export function killJob(id) {
  const j = jobs.get(String(id || ''));
  if (!j) return { ok: false, error: 'job not found' };
  if (j.status !== 'running' && j.status !== 'queued') return { ok: false, error: `job is ${j.status}, not running` };
  try { j._controller && j._controller.abort(); } catch { /* noop */ }
  j.status = 'killed';
  j.finishedAt = Date.now();
  return { ok: true, id: j.id, status: 'killed' };
}

/** Job counts for diagnostics. */
export function jobStats() {
  const by = {};
  for (const j of jobs.values()) by[j.status] = (by[j.status] || 0) + 1;
  return { total: jobs.size, by };
}

function publicJob(j) {
  return {
    id: j.id,
    task: String(j.task || '').slice(0, 200),
    session: j.session,
    status: j.status,
    answer: j.status === 'finished' ? String(j.answer || '').slice(0, MAX_ANSWER_CHARS) : null,
    error: j.error,
    createdAt: j.createdAt,
    startedAt: j.startedAt,
    finishedAt: j.finishedAt,
    durationMs: j.startedAt && j.finishedAt ? j.finishedAt - j.startedAt : null,
  };
}

/**
 * JEXI OS — Phase 6 Scope B: scheduler delivery — report.
 *
 * Reads the persistent queue and shapes a compact, UI-ready history. Used by
 * GET /api/scheduler/jobs and by the run ledger for a single job.
 */

/**
 * @param {object} store  a JobStore (queue/store.js)
 * @param {{ limit?: number, status?: string, jobId?: string }} opts
 */
export function jobHistoryReport(store, { limit = 25, status = '', jobId = '' } = {}) {
  const jobs = store.listJobs({ limit: limit * 2 });
  const runs = store.listRuns({ limit: Math.max(1, limit) });
  const filtered = status ? runs.filter((r) => r.status === status) : runs;
  const byStatus = {};
  for (const r of runs) byStatus[r.status] = (byStatus[r.status] || 0) + 1;

  return {
    ok: true,
    counts: {
      jobs: jobs.length,
      runs: runs.length,
      byStatus,
    },
    runs: filtered.slice(0, limit),
    jobId: jobId || null,
  };
}

/** A single run's full record (with its job), or null. */
export function runReport(store, runId) {
  const run = store.getRun(runId);
  if (!run) return null;
  const job = run.jobId ? store.getJob(run.jobId) : null;
  return { ok: true, run, job: job ? publicJob(job) : null };
}

/** Strip internal fields from a persisted job for API output. */
export function publicJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    name: job.name || '',
    kind: job.kind,
    lane: job.lane || 'default',
    priority: job.priority ?? 0,
    enabled: !!job.enabled,
    cron: job.cron ?? null,
    event: job.event ?? null,
    condition: job.condition ?? null,
    intervalSeconds: job.intervalSeconds ?? null,
    action: job.action,
    lastRunAt: job.lastRunAt ?? null,
    lastStatus: job.lastStatus ?? null,
    runCount: job.runCount ?? 0,
    nextRunAt: job.nextRunAt ?? null,
    createdAt: job.createdAt,
  };
}
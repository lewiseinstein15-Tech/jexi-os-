/**
 * B137 — SCHEDULE RUNTIME (DeepSeek Harness `packages/schedule/schedule`
 * mirror, JEXI-branded).
 *
 * Read-side inspection of the recurring-work scheduler: every schedule with
 * its cadence, next run, last run, and run state — the runtime view for
 * /api/schedule/runtime. JEXI's TaskScheduler is the owning engine; this
 * module only surfaces its state safely (public fields, no internals).
 */

/** Public runtime view of every schedule. */
export function scheduleRuntimeStatus(scheduler) {
  try {
    const sched = scheduler || (globalThis.taskScheduler);
    if (!sched || typeof sched.list !== 'function') {
      return { ok: true, schedules: [], note: 'scheduler unavailable' };
    }
    const schedules = sched.list().map((s) => ({
      id: s.id,
      label: s.label || '',
      query: String(s.query || '').slice(0, 200),
      kind: s.kind || 'task',
      status: s.status || 'unknown',
      everySeconds: s.everySeconds ?? null,
      dailyAt: s.dailyAt ?? null,
      nextRunAt: s.nextRunAt ?? null,
      lastRunAt: s.lastRunAt ?? null,
      lastStatus: s.lastStatus ?? null,
      runCount: typeof s.runCount === 'number' ? s.runCount : null,
    }));
    return {
      ok: true,
      count: schedules.length,
      active: schedules.filter((s) => s.status === 'active').length,
      paused: schedules.filter((s) => s.status === 'paused').length,
      schedules,
    };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

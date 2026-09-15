/**
 * JEXI OS — Phase 6 Scope B: scheduler delivery — notify.
 *
 * Emits every scheduler lifecycle change on the Observer bus and best-effort
 * pushes a NotificationCenter entry, so a fired job is visible to the UI with
 * no polling. Both are optional: a missing sink never breaks the scheduler.
 */

import { emit } from '../../services/Observer.js';

const NOTIFY_EVENTS = new Set(['job.completed', 'job.failed']);

/**
 * @param {string} type  one of job.scheduled|job.fired|job.started|job.completed|job.failed
 * @param {object} payload
 */
export function notifyScheduler(type, payload = {}) {
  const summary = payload.summary || `${type} ${payload.jobId ?? ''}`.trim();
  let evt = null;
  try {
    evt = emit(`scheduler.${type}`, {
      missionId: payload.missionId ?? null,
      actor: 'scheduler',
      summary,
      data: payload,
    });
  } catch {
    /* the bus is bounded and never throws, but never let delivery break a run */
  }

  if (NOTIFY_EVENTS.has(type)) {
    import('../../services/NotificationCenter.js')
      .then(({ notify }) => notify({
        title: type === 'job.completed' ? 'Scheduled job completed' : 'Scheduled job failed',
        body: summary.slice(0, 300),
        kind: type === 'job.completed' ? 'success' : 'warning',
      }))
      .catch(() => {});
  }
  return evt;
}

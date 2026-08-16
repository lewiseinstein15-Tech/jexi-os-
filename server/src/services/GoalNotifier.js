/**
 * JEXI OS — Goal Notifier (Phase 4: "reply when done").
 *
 * When a background goal job reaches a terminal state (done / failed), JEXI
 * tells the user like a real autonomous agent:
 *
 *   1. ALWAYS  — an in-app notification (Notification Center bell).
 *   2. OPTIONAL — an email report when a recipient is configured
 *      (GOAL_REPORT_EMAIL env var, or Settings → goalReportEmail) AND the
 *      email connector is available. Plain-text report: goal, status,
 *      summary, job id, attempts, auto-approvals, link to the live stream.
 *
 * Everything is best-effort and never throws — a notification or email
 * failure must never break the goal pipeline. Dedupes per job id so a job
 * can never notify twice.
 */

import { notify } from './NotificationCenter.js';
import { loadSettings } from './SettingsManager.js';

/**
 * The creator's email is the DEFAULT report recipient baked into the code —
 * JEXI's owner always gets goal reports even with zero configuration.
 * Explicit configuration still wins:
 *   1. GOAL_REPORT_EMAIL env var  → 2. Settings → goalReportEmail  → 3. this.
 */
export const DEFAULT_REPORT_EMAIL = 'lewiseinstein15@gmail.com';

/** Injectable connector caller (defaults wired in index.js). */
let callConnectorImpl = null;
/** Dedupe: job ids already reported. */
const reported = new Set();
/** Observable record of every email send attempt (capped). */
const emailReports = [];

export function setGoalCallConnector(fn) {
  callConnectorImpl = fn;
}

export function resetGoalNotifier() {
  reported.clear();
  emailReports.length = 0;
}

/** Live email-send record — lets the owner verify deliveries (no secrets). */
export function goalReportStats() {
  return {
    sends: emailReports.length,
    ok: emailReports.filter((r) => r.ok).length,
    failed: emailReports.filter((r) => !r.ok).length,
    last: emailReports.length ? { ...emailReports[emailReports.length - 1] } : null,
  };
}

/** Recipient for goal reports: env > Settings panel > code default (creator). */
export function goalReportRecipient() {
  try {
    const settings = loadSettings();
    return String(process.env.GOAL_REPORT_EMAIL || settings.goalReportEmail || DEFAULT_REPORT_EMAIL).trim() || DEFAULT_REPORT_EMAIL;
  } catch {
    return String(process.env.GOAL_REPORT_EMAIL || DEFAULT_REPORT_EMAIL).trim() || DEFAULT_REPORT_EMAIL;
  }
}

/** Strip markdown-ish noise for the plain-text email body. */
function toPlainText(md) {
  return String(md || '')
    .replace(/```[\s\S]*?```/g, (b) => b.replace(/^```\w*\n?|\n?```$/g, '').slice(0, 400))
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/[*_`>~#|]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Report a terminal goal job. `job` is the internal queue record (has id,
 * goal, status, result, error, autonomy, attempts, autoApprovals).
 */
export function notifyGoalComplete(job) {
  if (!job || !job.id || reported.has(job.id)) return;
  reported.add(job.id);

  const ok = job.status === 'done';
  const kind = ok ? 'success' : 'error';
  const isChat = job.kind === 'chat';
  const title = `${ok ? '✅' : '⚠️'} ${isChat ? 'Task complete' : 'Goal complete'}${ok ? '' : ' — failed'}: ${String(job.goal || job.query || '').slice(0, 90)}`;
  const summary = ok
    ? String((job.result && (job.result.summary || '')) || 'Finished.').slice(0, 300)
    : String(job.error || (job.result && job.result.error) || 'Failed.').slice(0, 300);

  // 1) In-app notification (always).
  try {
    notify({ title, body: summary, kind, link: `/api/goals/${job.id}/stream` });
  } catch (e) { /* never break the pipeline */ }

  // 2) Email report (only when a recipient is configured + connector ready).
  const to = goalReportRecipient();
  if (!to || typeof callConnectorImpl !== 'function') return;
  const attempts = job.attempts || 0;
  const autoApprovals = (job.autoApprovals || []).length;
  const text = [
    `JEXI OS — Goal ${ok ? 'Complete' : 'Failed'}`,
    '',
    `Goal: ${String(job.goal || '').slice(0, 500)}`,
    `Status: ${ok ? 'DONE' : 'FAILED'}`,
    `Autonomy: ${String(job.autonomy || 'ask').toUpperCase()}`,
    `Attempts: ${attempts}`,
    autoApprovals > 0 ? `Auto-approved confirmations: ${autoApprovals}` : null,
    '',
    'Report:',
    toPlainText(summary).slice(0, 2000),
    '',
    `Live stream: /api/goals/${job.id}/stream`,
  ].filter(Boolean).join('\n');

  (async () => {
    let ok = false;
    let error = '';
    try {
      // callConnector NEVER throws — it returns { ok:false, error, code } on
      // failure (it catches provider errors internally), so success is
      // `result.ok === true`, NOT "no exception". Checking the result keeps
      // the send record honest (a missing key is recorded as failed).
      const result = await callConnectorImpl('email', {
        method: 'send',
        payload: { to, subject: title.slice(0, 120), text },
      });
      ok = !!(result && result.ok);
      if (!ok) error = String((result && (result.error || result.code)) || 'email send failed');
    } catch (e) {
      error = (e && e.message) || String(e);
    }
    emailReports.push({ at: Date.now(), jobId: job.id, to, ok, error: error.slice(0, 200) });
    if (emailReports.length > 50) emailReports.shift();
  })();
}

/** Test helper: how many jobs have been reported. */
export function reportedCount() {
  return reported.size;
}

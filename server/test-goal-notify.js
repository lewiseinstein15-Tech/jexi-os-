/**
 * JEXI OS — Goal Notifier regression suite (Phase 4: "reply when done").
 * Verifies: in-app notification always; email report when a recipient is
 * configured; dedupe; no-throw on failures.
 */

import { notify, listNotifications, clearNotifications } from './src/services/NotificationCenter.js';
import {
  notifyGoalComplete, setGoalCallConnector, resetGoalNotifier,
  goalReportRecipient, reportedCount,
} from './src/services/GoalNotifier.js';
import { enqueueGoal, resetGoalJobs, getJob, setGoalExecutor, setGoalNotifier } from './src/services/GoalJobQueue.js';

let passed = 0;
let failed = 0;
const ok = (cond, name) => {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}`); }
};

function waitFor(pred, ms = 5000) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (pred() || Date.now() - t0 > ms) { clearInterval(iv); resolve(); }
    }, 50);
  });
}

console.log('\n== In-app notification on goal completion ==');
clearNotifications();
resetGoalNotifier();
resetGoalJobs();
setGoalNotifier(notifyGoalComplete);
setGoalCallConnector(null); // no email in this test
setGoalExecutor({
  async startGoal({ goal, sendEvent }) {
    sendEvent('goal.start', { goalId: 'g-n1', goal });
    return { goalId: 'g-n1', result: { success: true, summary: '✅ The research report is ready.' } };
  },
  async resumeWithInfo() { return { ok: false, error: 'n/a' }; },
});
const j1 = enqueueGoal({ goal: 'research the market for electric bikes', session: 'notify-1', autonomy: 'ask' });
await waitFor(() => getJob(j1.id)?.status === 'done');
const notifs = listNotifications();
ok(notifs.length >= 1, 'notification created on goal completion');
ok(/research the market for electric bikes/.test(notifs[0].title), 'notification names the goal');
ok(notifs[0].kind === 'success', 'kind is success for done goals');
ok(reportedCount() >= 1, 'notifier recorded the job');

console.log('\n== Email report when recipient configured ==');
resetGoalNotifier();
clearNotifications();
const sent = [];
setGoalCallConnector(async (name, { method, payload }) => {
  sent.push({ name, method, payload });
  return { ok: true };
});
process.env.GOAL_REPORT_EMAIL = 'owner@example.com';
ok(goalReportRecipient() === 'owner@example.com', 'recipient read from env');
notifyGoalComplete({ id: 'job-email-1', goal: 'book a flight to Mombasa', status: 'done', autonomy: 'full', attempts: 1, autoApprovals: ['x'], result: { summary: '**Flight booked** for tomorrow.' } });
await new Promise((r) => setTimeout(r, 100));
ok(sent.length === 1, 'email send attempted once');
ok(sent[0].name === 'email' && sent[0].method === 'send', 'email connector send called');
ok(sent[0].payload.to === 'owner@example.com', 'recipient passed through');
ok(/book a flight to Mombasa/.test(sent[0].payload.subject), 'subject names the goal');
ok(/Flight booked for tomorrow/.test(sent[0].payload.text), 'plain-text report includes the summary');
delete process.env.GOAL_REPORT_EMAIL;

console.log('\n== Dedupe — one report per job ==');
// Clear the list but NOT the dedupe set: the previous call already registered
// 'job-email-1', so this second call must be a complete no-op (no email, no
// notification) — only the original notification remains visible.
clearNotifications();
notifyGoalComplete({ id: 'job-email-1', goal: 'book a flight to Mombasa', status: 'done', autonomy: 'full', attempts: 1, autoApprovals: [], result: { summary: 'again' } });
await new Promise((r) => setTimeout(r, 100));
ok(sent.length === 1, 'no duplicate email for the same job id');
const notifs2 = listNotifications();
const dupes = notifs2.filter((n) => /book a flight to Mombasa/.test(n.title)).length;
ok(dupes === 0, 'no duplicate notification for the same job id');

console.log('\n== Failed goals notify with error kind ==');
resetGoalNotifier();
clearNotifications();
notifyGoalComplete({ id: 'job-fail-1', goal: 'deploy the app', status: 'failed', autonomy: 'ask', attempts: 2, autoApprovals: [], error: 'provider timeout', result: { success: false, error: 'provider timeout' } });
const failNotifs = listNotifications();
ok(failNotifs.length === 1, 'failure creates a notification');
ok(failNotifs[0].kind === 'error', 'failure kind is error');
ok(/provider timeout/.test(failNotifs[0].body), 'failure reason in the body');

console.log('\n== No recipient → no email, no throw ==');
resetGoalNotifier();
const before = sent.length;
notifyGoalComplete({ id: 'job-norecip', goal: 'x', status: 'done', autonomy: 'ask', attempts: 1, autoApprovals: [], result: { summary: 'y' } });
await new Promise((r) => setTimeout(r, 50));
ok(sent.length === before, 'no email without a recipient');

console.log('\n== End-to-end: queued job notifies on completion ==');
resetGoalNotifier();
clearNotifications();
setGoalCallConnector(null);
setGoalExecutor({
  async startGoal({ goal, sendEvent }) {
    sendEvent('goal.start', { goalId: 'g-n2', goal });
    return { goalId: 'g-n2', result: { success: true, summary: '✅ Done.' } };
  },
  async resumeWithInfo() { return { ok: false }; },
});
const j2 = enqueueGoal({ goal: 'organize my photos', session: 'notify-2', autonomy: 'ask' });
await waitFor(() => getJob(j2.id)?.status === 'done');
await new Promise((r) => setTimeout(r, 100));
ok(listNotifications().some((n) => /organize my photos/.test(n.title)), 'queue worker reported the completed goal');

setGoalNotifier(null);
setGoalCallConnector(null);

console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

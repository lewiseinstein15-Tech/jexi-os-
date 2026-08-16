/**
 * JEXI OS — durable chat regression suite (B85).
 * Chat tasks run on the same durable queue as goals: enqueue → worker runs
 * the (mocked) chat executor → done; confirmations park the job; a reply
 * resumes it. Restart survival + notifications ride the goal queue.
 */

import {
  enqueueChat, answerJob, getJob, getJobEvents, subscribe,
  resetGoalJobs, jobCounts, setGoalExecutor, setChatExecutor, setGoalNotifier,
} from './src/services/GoalJobQueue.js';

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

console.log('\n== Chat job runs to completion ==');
resetGoalJobs();
const calls = [];
setChatExecutor({
  async run({ query, session, sendEvent }) {
    calls.push(['run', query, session]);
    sendEvent('log', { agent: 'Coder', message: 'working…' });
    return { success: true, summary: '✅ Built the app.', files: ['app.js'] };
  },
  async resume() { return { success: false, error: 'n/a' }; },
});
const { id } = enqueueChat({ query: 'build me a todo app', session: 'chat-1' });
ok(id.startsWith('job-'), 'enqueueChat returns a job id');
await waitFor(() => getJob(id)?.status === 'done');
ok(getJob(id).status === 'done', 'chat job completes');
ok(calls.some((c) => c[0] === 'run' && c[1] === 'build me a todo app' && c[2] === 'chat-1'), 'executor ran with query + session');
const evs = getJobEvents(id);
ok(evs.some((e) => e.type === 'chat.started'), 'chat.started event emitted');
ok(evs.some((e) => e.type === 'done' && e.summary.includes('Built the app')), 'done event carries the summary');
ok(getJob(id).result.files[0] === 'app.js', 'result stored');

console.log('\n== Chat job failure recorded ==');
resetGoalJobs();
setChatExecutor({
  async run() { return { success: false, error: 'provider down', summary: '⚠ failed' }; },
  async resume() { return { success: false }; },
});
const f = enqueueChat({ query: 'research x', session: 'chat-2' });
await waitFor(() => getJob(f.id)?.status === 'failed');
ok(getJob(f.id).status === 'failed' && /provider down/.test(getJob(f.id).result?.error || ''), 'failure recorded');

console.log('\n== Chat job parks on confirmation, resume completes ==');
resetGoalJobs();
let resumeAnswer = null;
setChatExecutor({
  async run({ session, sendEvent }) {
    sendEvent('log', { agent: 'Planner', message: 'needs confirmation' });
    return { success: true, summary: '🤔 Please confirm before I continue.', paused: true };
  },
  async resume({ session, answer, sendEvent }) {
    resumeAnswer = answer;
    sendEvent('log', { agent: 'Planner', message: 'confirmed — continuing' });
    return { success: true, summary: '✅ Finished after your confirmation.' };
  },
});
const p = enqueueChat({ query: 'deploy my app', session: 'chat-3' });
await waitFor(() => getJob(p.id)?.status === 'need-info');
ok(getJob(p.id).status === 'need-info', 'parked as need-info on confirmation');
ok(getJob(p.id).infoRequests.length === 1, 'infoRequest recorded');
const ack = answerJob(p.id, 'yes go ahead');
ok(ack.ok === true, 'answer accepted');
await waitFor(() => getJob(p.id)?.status === 'done');
ok(getJob(p.id).status === 'done', 'resumed and completed');
ok(resumeAnswer === 'yes go ahead', 'executor received the answer');

console.log('\n== Notifier fires for chat jobs ==');
resetGoalJobs();
let reported = 0;
setGoalNotifier(() => { reported += 1; });
setChatExecutor({
  async run() { return { success: true, summary: 'ok' }; },
  async resume() { return { success: false }; },
});
const n = enqueueChat({ query: 'summarize my inbox', session: 'chat-4' });
await waitFor(() => getJob(n.id)?.status === 'done');
await new Promise((r) => setTimeout(r, 100));
ok(reported >= 1, 'chat completion reported (notification/email/push)');

console.log('\n== Goal jobs unaffected ==');
setGoalExecutor({
  async startGoal({ goal, sendEvent }) {
    sendEvent('goal.start', { goalId: 'g-x', goal });
    return { goalId: 'g-x', result: { success: true, summary: 'goal ok' } };
  },
  async resumeWithInfo() { return { ok: false }; },
});
const g = (await import('./src/services/GoalJobQueue.js')).enqueueGoal;
const gj = g({ goal: 'goal test', session: 'chat-5', autonomy: 'ask' });
await waitFor(() => getJob(gj.id)?.status === 'done');
ok(getJob(gj.id).status === 'done', 'goal job still completes alongside chat jobs');

setGoalNotifier(null);
setChatExecutor(null);

console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

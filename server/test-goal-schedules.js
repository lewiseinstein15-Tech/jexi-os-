/**
 * JEXI OS — scheduled GOALS regression suite (Build 82).
 * Verifies the scheduler's goal-kind path: cadence computation (interval +
 * dailyAt), firing enqueues a durable goal job, no-stacking, pause/resume,
 * run-now, and publicSchedule shape.
 */

import { taskScheduler } from './src/services/TaskScheduler.js';
import { enqueueGoal, getJob, resetGoalJobs, setGoalExecutor } from './src/services/GoalJobQueue.js';

let passed = 0;
let failed = 0;
const ok = (cond, name) => {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}`); }
};

// Drive the scheduler deterministically: kill its real ticker, use our own tick.
clearInterval(taskScheduler._ticker);

setGoalExecutor({
  async startGoal({ goal, sendEvent }) {
    sendEvent('goal.start', { goalId: 'g-sched', goal });
    return { goalId: 'g-sched', result: { success: true, summary: `✅ scheduled run: ${goal}` } };
  },
  async resumeWithInfo() { return { ok: false }; },
});

function tickNow() { taskScheduler.tick(); }

console.log('\n== Create: cadence validation ==');
let r = taskScheduler.create({ query: 'no cadence', kind: 'goal' });
ok(r.error && /everySeconds|dailyAt/.test(r.error), 'missing cadence rejected');
r = taskScheduler.create({ query: 'bad daily', kind: 'goal', dailyAt: '25:99' });
ok(r.error && /HH:MM/.test(r.error), 'invalid dailyAt rejected');
r = taskScheduler.create({ query: 'research the news', kind: 'goal', autonomy: 'full', everySeconds: 5 });
ok(r.schedule && r.schedule.kind === 'goal', 'goal schedule created');
ok(r.schedule.autonomy === 'full', 'autonomy persisted');
ok(r.schedule.everySeconds === 5 && r.schedule.dailyAt === null, 'interval cadence persisted');
ok(r.schedule.nextRunAt > Date.now() && r.schedule.nextRunAt <= Date.now() + 6000, 'nextRunAt in ~5s');
const schId = r.schedule.id;

console.log('\n== dailyAt cadence ==');
const d = taskScheduler.create({ query: 'morning briefing', kind: 'goal', dailyAt: '08:00' });
ok(d.schedule.dailyAt === '08:00' && d.schedule.everySeconds === null, 'dailyAt persisted, interval null');
const next = new Date(d.schedule.nextRunAt);
ok(next.getHours() === 8 && next.getMinutes() === 0, `next run lands at 08:00 (got ${next.getHours()}:${next.getMinutes()})`);
ok(next.getTime() > Date.now(), 'next run is in the future');

console.log('\n== Firing enqueues a durable goal job ==');
resetGoalJobs();
taskScheduler.get(schId).nextRunAt = Date.now() - 1; // make it due
tickNow();
const s = taskScheduler.get(schId);
ok(s.lastJobId && String(s.lastJobId).startsWith('job-'), 'tick launched a goal job');
ok(s.runCount === 1, 'runCount incremented');
ok(s.lastStatus === 'queued', 'lastStatus queued');
const job = getJob(s.lastJobId);
ok(job && (job.status === 'queued' || job.status === 'running' || job.status === 'done'), 'job exists in the queue');
ok(job.goal === 'research the news', 'job carries the schedule query');
ok(job.autonomy === 'full', 'job carries the schedule autonomy');

console.log('\n== No stacking while a goal is running ==');
// Force the job to look running, then tick again — must NOT fire a second run.
const j = getJob(s.lastJobId);
if (j) j.status = 'running';
taskScheduler.get(schId).nextRunAt = Date.now() - 1;
tickNow();
ok(taskScheduler.get(schId).runCount === 1, 'no second run while the goal is still running');

console.log('\n== Pause / resume / run-now / remove ==');
const p = taskScheduler.pause(schId);
ok(p.status === 'paused', 'paused');
taskScheduler.get(schId).nextRunAt = Date.now() - 1;
tickNow();
ok(taskScheduler.get(schId).runCount === 1, 'paused schedule does not fire');
const resumed = taskScheduler.resume(schId);
ok(resumed.status === 'active', 'resumed');
ok(resumed.nextRunAt > Date.now(), 'resume restarts the countdown from now');
const rn = taskScheduler.runNow(schId);
ok(rn.runCount === 2, 'run-now fires immediately');
ok(taskScheduler.remove(schId) === true, 'removed');
ok(taskScheduler.get(schId) === null, 'gone after remove');

console.log('\n== publicSchedule shape ==');
const pub = taskScheduler.publicSchedule(d.schedule);
ok(pub.kind === 'goal' && 'lastJobId' in pub && 'lastSummary' in pub && 'dailyAt' in pub, 'goal fields exposed');

console.log('\n== Legacy task schedules still work ==');
const t = taskScheduler.create({ query: 'hello task', everySeconds: 60 });
ok(t.schedule.kind === 'task', 'default kind stays task');
ok(t.schedule.everySeconds === 60, 'task cadence intact');
taskScheduler.remove(t.schedule.id);
taskScheduler.remove(d.schedule.id);

console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

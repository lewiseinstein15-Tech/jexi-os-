import { taskScheduler } from './src/services/TaskScheduler.js';
import { taskManager } from './src/services/TaskManager.js';

/**
 * Stage-23 test — recurring missions (automation scheduler).
 *
 * Uses only DETERMINISTIC intents (identity answers without any API key or
 * network). Each scheduled run launches a real background mission through
 * TaskManager — the same pipeline a user's schedule uses.
 */

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(predicate, timeoutMs = 8000, stepMs = 120) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return true;
    await wait(stepMs);
  }
  return predicate();
}

async function runTests() {
  console.log('🧪 Testing JEXI OS recurring missions (roadmap stage 23)\n');

  const createdTasks = [];
  const cleanup = () => {
    for (const id of createdTasks) taskManager.remove(id);
  };

  // 1. Create a schedule that fires every second.
  const created = taskScheduler.create({
    query: 'Tell me who you are and who created you',
    label: 'test every 1s',
    everySeconds: 1,
  });
  if (created.error || !created.schedule) {
    console.log(`✗ create failed: ${created.error}`);
    process.exitCode = 1;
    return;
  }
  const s = taskScheduler.get(created.schedule.id);
  console.log(`📝 schedule ${s.id} → every ${s.everySeconds}s, status ${s.status}`);

  // 2. First run fires within a couple of ticks.
  const first = await waitFor(() => taskScheduler.get(s.id)?.runCount >= 1, 8000);
  let cur = taskScheduler.get(s.id);
  console.log(`   first run: ${first ? '✓ fired' : '✗ never fired'} (runCount=${cur?.runCount})`);
  if (!first) { console.log('   ✗ schedule never fired'); process.exitCode = 1; cleanup(); return; }
  if (cur.lastTaskId) {
    createdTasks.push(cur.lastTaskId);
    const t = await taskManager.waitFor(cur.lastTaskId, 15_000);
    console.log(`   mission ${cur.lastTaskId} → ${t?.status || 'unknown'}${t?.status === 'done' ? ' ✓' : ' (check the task stream)'}`);
    if (t?.status !== 'done') { console.log('   ✗ expected the mission to complete'); process.exitCode = 1; }
  }

  // 3. It recurs.
  const second = await waitFor(() => taskScheduler.get(s.id)?.runCount >= 2, 8000);
  cur = taskScheduler.get(s.id);
  if (cur?.lastTaskId && cur.lastTaskId !== createdTasks[createdTasks.length - 1]) createdTasks.push(cur.lastTaskId);
  console.log(`   recurring: ${second ? `✓ runCount=${cur.runCount}` : '✗ did not recur'}`);
  if (!second) process.exitCode = 1;

  // 4. Pause stops new runs.
  taskScheduler.pause(s.id);
  const pausedCount = taskScheduler.get(s.id)?.runCount || 0;
  await wait(1800);
  const afterPause = taskScheduler.get(s.id)?.runCount || 0;
  console.log(`   pause: ✓ runCount stayed ${afterPause} (was ${pausedCount})${afterPause === pausedCount ? '' : ' — ✗ still firing'}`);
  if (afterPause !== pausedCount) process.exitCode = 1;

  // 5. Resume restarts the cadence.
  taskScheduler.resume(s.id);
  const resumed = await waitFor(() => (taskScheduler.get(s.id)?.runCount || 0) > afterPause, 8000);
  cur = taskScheduler.get(s.id);
  if (cur?.lastTaskId && !createdTasks.includes(cur.lastTaskId)) createdTasks.push(cur.lastTaskId);
  console.log(`   resume: ${resumed ? `✓ runCount=${cur?.runCount}` : '✗ did not resume'}`);
  if (!resumed) process.exitCode = 1;

  // 6. run-now fires immediately.
  const before = taskScheduler.get(s.id)?.runCount || 0;
  taskScheduler.runNow(s.id);
  await wait(300);
  const afterNow = taskScheduler.get(s.id)?.runCount || 0;
  cur = taskScheduler.get(s.id);
  if (cur?.lastTaskId && !createdTasks.includes(cur.lastTaskId)) createdTasks.push(cur.lastTaskId);
  console.log(`   run-now: ${afterNow > before ? `✓ runCount=${afterNow}` : '✗ did not fire'}`);
  if (afterNow <= before) process.exitCode = 1;

  // 7. Delete removes it (and stops future runs).
  const removed = taskScheduler.remove(s.id);
  console.log(`   delete: ${removed && !taskScheduler.get(s.id) ? '✓ gone' : '✗ still present'}`);
  if (removed && taskScheduler.get(s.id)) process.exitCode = 1;

  cleanup();
  console.log('\n✅ Recurring-mission tests complete');
}

runTests().catch((e) => { console.error('✗ Test runner crashed:', e); process.exit(1); });

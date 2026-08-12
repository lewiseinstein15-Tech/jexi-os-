import { taskManager } from './src/services/TaskManager.js';

/**
 * Stage-8 test — background task system + task.* event vocabulary.
 *
 * Uses only DETERMINISTIC intents (identity + explain-team answer without any
 * API key or network), plus a cancel-path check. The mission pipeline runs in
 * the background exactly as it would for a real user.
 */

async function runTests() {
  console.log('🧪 Testing JEXI OS background task system (roadmap stage 8)\n');

  const cases = [
    { name: 'identity (conversation)', query: 'Tell me who you are and who created you', expect: 'done' },
    { name: 'explain team (explain_team)', query: 'explain how your team plans a task', expect: 'done' },
  ];

  for (const c of cases) {
    const task = taskManager.createTask(c.query);
    console.log(`📝 "${c.name}" → ${task.id} (${task.status})`);

    const final = await taskManager.waitFor(task.id, 90_000);
    if (!final) { console.log('   ✗ task disappeared'); process.exitCode = 1; continue; }

    const types = [...new Set((final.events || []).map((e) => e.type))];
    const seconds = ((final.finishedAt - final.createdAt) / 1000).toFixed(1);
    console.log(`   final: ${final.status} in ${seconds}s · ${(final.events || []).length} events`);
    console.log(`   vocabulary: ${types.join(', ')}`);

    if (final.status !== c.expect) {
      console.log(`   ✗ expected ${c.expect} but got ${final.status}${final.error ? ` — ${final.error}` : ''}`);
      process.exitCode = 1;
    } else if (!final.summary || !String(final.summary).trim()) {
      console.log('   ✗ expected a readable summary');
      process.exitCode = 1;
    } else if (!types.includes('task.started') || !types.includes('task.plan') || !types.includes('task.done')) {
      console.log('   ✗ expected task.started / task.plan / task.done events');
      process.exitCode = 1;
    } else {
      console.log('   ✓ done, summary present, full event lifecycle streamed');
    }
    console.log('');
  }

  // Cancel path — a background mission must be cancellable mid-flight.
  console.log('⏹ Cancelling a running mission…');
  const t2 = taskManager.createTask('Research the history of the wheel');
  taskManager.cancel(t2.id);
  const fin2 = await taskManager.waitFor(t2.id, 60_000);
  if (!fin2) { console.log('   ✗ task disappeared'); process.exitCode = 1; }
  else {
    const types2 = [...new Set((fin2.events || []).map((e) => e.type))];
    console.log(`   ${fin2.id} → ${fin2.status} · ${types2.join(', ')}`);
    if (fin2.status === 'cancelled' && types2.includes('task.cancelled')) {
      console.log('   ✓ cancelled cleanly with a task.cancelled event');
    } else {
      console.log(`   ✗ expected cancelled; got ${fin2.status}`);
      process.exitCode = 1;
    }
  }

  console.log('\n✅ Background task system tests complete');
}

runTests().catch((e) => { console.error('✗ Test runner crashed:', e); process.exit(1); });

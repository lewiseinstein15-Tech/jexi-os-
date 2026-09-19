// PHASE 21 — SCOPE D — LIVE PROBE: fixed wall-clock budget.
// Zone-compliant: no file writes at all (worker termination is in-memory).
import assert from 'node:assert';

import { enforceBudget } from '../research/budget/wall-clock.js';
import { createCostLedger, withLedger } from '../research/budget/cost.js';

const sleepFn = async () => {
  await new Promise((r) => setTimeout(r, 100));
  return 'done';
};

const ledger = createCostLedger();
const run = withLedger(enforceBudget, ledger);

try {
  // ---- case 1: sleeps 100ms with a 50ms budget -> terminated, overBudget: true ----
  const c1 = await run(sleepFn, 50, { experimentId: 'over-budget-sleep' });
  console.log(
    `[case 1] 100ms fn / 50ms budget -> overBudget=${c1.overBudget} killed=${c1.killed} elapsedMs=${c1.elapsedMs}${c1.error ? ` error=${c1.error}` : ''}`,
  );

  // ---- case 2: same fn with a 200ms budget -> completed, overBudget: false ----
  const c2 = await run(sleepFn, 200, { experimentId: 'within-budget-sleep' });
  console.log(
    `[case 2] 100ms fn / 200ms budget -> overBudget=${c2.overBudget} killed=${c2.killed} elapsedMs=${c2.elapsedMs} result=${JSON.stringify(c2.result)}`,
  );

  // ---- case 3: inline mode — honest about what it can and cannot stop ----
  const c3 = await enforceBudget(sleepFn, 50, { mode: 'inline' });
  console.log(
    `[case 3] inline race 100ms fn / 50ms budget -> overBudget=${c3.overBudget} killed=${c3.killed} elapsedMs=${c3.elapsedMs}`,
  );
  console.log('[case 3] note:', c3.error);

  // ---- case 4: a BLOCKING busy-wait fn — the reason worker mode exists ----
  const spin = function spin(ms) {
    const t = Date.now();
    while (Date.now() - t < ms) {
      /* block the thread */
    }
    return 'spun';
  };
  const c4 = await run(spin, 80, { arg: 300, experimentId: 'busy-wait-kill' });
  console.log(
    `[case 4] blocking 300ms spin / 80ms budget -> overBudget=${c4.overBudget} killed=${c4.killed} elapsedMs=${c4.elapsedMs}`,
  );

  // ---- case 5: ledger totals across the recorded runs ----
  const totals = ledger.total();
  console.log(`[case 5] ledger totals: ${JSON.stringify(totals)}`);
  console.log(`[case 5] entries: ${JSON.stringify(ledger.entries())}`);

  // ---- assertions ----
  assert.equal(c1.overBudget, true, '100ms fn under 50ms budget must be over budget');
  assert.equal(c1.killed, true, 'worker must be terminated cleanly');
  assert.ok(c1.elapsedMs >= 45 && c1.elapsedMs < 200, `case1 elapsed ~50ms, got ${c1.elapsedMs}`);
  assert.equal(c2.overBudget, false, '100ms fn under 200ms budget must complete');
  assert.equal(c2.result, 'done');
  assert.ok(c2.elapsedMs >= 95 && c2.elapsedMs < 190, `case2 elapsed ~100ms, got ${c2.elapsedMs}`);
  assert.equal(c3.overBudget, true, 'inline race must report overBudget');
  assert.equal(c3.killed, false, 'inline race cannot kill — must be honest about it');
  assert.equal(c4.overBudget, true, 'blocking fn must be flagged over budget');
  assert.equal(c4.killed, true, 'blocking fn must be hard-terminated by worker mode');
  assert.equal(totals.experiments, 3, 'ledger recorded three runs');
  assert.equal(totals.overBudgetCount, 2);
  assert.equal(totals.killedCount, 2);
  assert.ok(totals.totalMs >= c1.elapsedMs + c2.elapsedMs + c4.elapsedMs - 5);

  console.log('\nSCOPE D PROBE PASSED');
} catch (err) {
  console.error('PROBE FAILURE:', err?.message ?? err);
  process.exit(1);
}

/**
 * M20 — BOUNDED TEST-DRIVEN REPAIR suite.
 *
 * Proves the repair loop (`benchmarks/humaneval-live/lib/repair.mjs`) behaves
 * honestly and stays bounded. The seam is injected (fake `runAttempt`/`grade`)
 * so every case is deterministic; one case uses the REAL official grader to
 * prove the loop accepts nothing but an actual grader pass.
 *
 * Deterministic, headless, ZERO network. Run:
 *   node --test tests/agi/test-m20-repair-loop.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runBoundedRepair, MAX_REPAIRS } from '../../../benchmarks/humaneval-live/lib/repair.mjs';
import { gradeLocally, GRADE_PY } from '../../../benchmarks/humaneval-live/lib/tasks.mjs';

/* ------------------------------------------------------------------ */
/* seam-injected cases                                                 */
/* ------------------------------------------------------------------ */

test('M20/R1: a repair that fixes a genuine incorrect solution is reported as recovered-by-repair', async () => {
  // attempt 0 fails the grader; attempt 1 passes.
  const verdicts = [false, true];
  let i = 0;
  const loop = await runBoundedRepair({
    maxRepairs: 2,
    runAttempt: async () => ({}),
    grade: async () => ({ passed: verdicts[i++], output: i === 1 ? 'AssertionError' : 'HUMANEVAL_GRADE=PASS', error: null }),
  });
  assert.equal(loop.finalPass, true);
  assert.equal(loop.resolvedByRepair, true, 'a pass after the first attempt is a repair');
  assert.equal(loop.attempts.length, 2);
  assert.deepEqual(loop.attempts.map((a) => a.pass), [false, true]);
});

test('M20/R2: a repair that still fails ends in an honest failure after the budget', async () => {
  const loop = await runBoundedRepair({
    maxRepairs: 2,
    runAttempt: async () => ({}),
    grade: async () => ({ passed: false, output: 'AssertionError: nope', error: null }),
  });
  assert.equal(loop.finalPass, false);
  assert.equal(loop.resolvedByRepair, false);
  assert.equal(loop.attempts.length, 3, '1 initial + 2 repairs');
  assert.ok(loop.attempts.every((a) => a.pass === false));
});

test('M20/R3: a repair attempt that times out is never a pass and consumes budget', async () => {
  // Every attempt times out; the grader would pass, but a timeout is not a pass.
  const loop = await runBoundedRepair({
    maxRepairs: 2,
    runAttempt: async () => ({ error: 'agent loop timed out after 300000ms' }),
    grade: async () => ({ passed: true, output: 'HUMANEVAL_GRADE=PASS', error: null }),
  });
  assert.equal(loop.finalPass, false, 'a timeout is never a pass even if a leftover file grades');
  assert.ok(loop.attempts.every((a) => a.agentTimedOut === true));
  assert.equal(loop.attempts.length, 3);
});

test('M20/R4: a grader that cannot run is never a pass', async () => {
  const loop = await runBoundedRepair({
    maxRepairs: 2,
    runAttempt: async () => ({}),
    grade: async () => ({ passed: false, output: '', error: 'spawn python3 ENOENT' }),
  });
  assert.equal(loop.finalPass, false);
  assert.ok(loop.attempts.every((a) => a.graderRan === false));
});

test('M20/R5: a model that CLAIMS success but fails the grader is not a pass (no self-grading)', async () => {
  // runAttempt returns a confident "done" with no error, but the grader fails.
  const loop = await runBoundedRepair({
    maxRepairs: 2,
    runAttempt: async () => ({ answer: 'I have fixed it. The tests pass. ✅' }),
    grade: async () => ({ passed: false, output: 'AssertionError', error: null }),
  });
  assert.equal(loop.finalPass, false, 'the model cannot mark its own work as verified');
  assert.equal(loop.attempts.length, 3);
});

test('M20/R6: the repair budget is strictly enforced (never more than maxRepairs repairs)', async () => {
  let gradeCalls = 0;
  const loop = await runBoundedRepair({
    maxRepairs: 2,
    runAttempt: async () => ({}),
    grade: async () => { gradeCalls++; return { passed: false, output: 'x', error: null }; },
  });
  assert.equal(loop.attempts.length, MAX_REPAIRS + 1);
  assert.equal(gradeCalls, MAX_REPAIRS + 1, 'the grader runs once per attempt, no more');
});

test('M20/R7: the final allowed attempt can still pass (verdict accurate after the last attempt)', async () => {
  const verdicts = [false, false, true]; // passes only on the 3rd (last) attempt
  let i = 0;
  const loop = await runBoundedRepair({
    maxRepairs: 2,
    runAttempt: async () => ({}),
    grade: async () => ({ passed: verdicts[i++], output: 'x', error: null }),
  });
  assert.equal(loop.finalPass, true);
  assert.equal(loop.resolvedByRepair, true);
  assert.equal(loop.attempts.length, 3);
});

test('M20/R8: makeRepairContext receives the REAL previous grade output and error', async () => {
  const seen = [];
  const verdicts = [false, true];
  let i = 0;
  await runBoundedRepair({
    maxRepairs: 2,
    runAttempt: async ({ attempt, ctx }) => { seen.push({ attempt, ctx }); return { error: attempt === 0 ? 'boom' : null }; },
    grade: async () => ({ passed: verdicts[i++], output: i === 1 ? 'AssertionError: expected 3 got 2' : 'ok', error: null }),
    makeRepairContext: ({ attempt, previousGradeOutput, previousAgentError }) => ({ attempt, previousGradeOutput, previousAgentError }),
  });
  assert.equal(seen.length, 2);
  assert.equal(seen[0].attempt, 0);
  assert.equal(seen[0].ctx.attempt, undefined, 'the first attempt gets no repair context');
  assert.equal(seen[1].ctx.attempt, 1);
  assert.match(seen[1].ctx.previousGradeOutput, /AssertionError/, 'the model is handed the actual failing output');
  assert.equal(seen[1].ctx.previousAgentError, 'boom');
});

/* ------------------------------------------------------------------ */
/* real official grader — the arbiter is real                          */
/* ------------------------------------------------------------------ */

test('M20/R9: with the REAL grader, only a genuinely correct file passes (an explanation never does)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm20-repair-test-'));
  const solutionName = 'solution.py';
  const testName = 'test_sol.py';
  fs.writeFileSync(path.join(dir, 'grade.py'), GRADE_PY);
  fs.writeFileSync(path.join(dir, testName), [
    'def check(fn):',
    '    assert fn(2, 3) == 5, "expected 5"',
    '    assert fn(0, 0) == 0',
    'check(add)',
  ].join('\n'));

  // Attempt 0 writes a WRONG implementation; attempt 1 writes the correct one.
  const bodies = [
    'def add(a, b):\n    return a - b\n',   // wrong
    'def add(a, b):\n    return a + b\n',   // correct
  ];
  let i = 0;
  const loop = await runBoundedRepair({
    maxRepairs: 2,
    runAttempt: async () => { fs.writeFileSync(path.join(dir, solutionName), bodies[i++]); return {}; },
    grade: async () => gradeLocally({ sandboxDir: dir, solutionName, testName, entryPoint: 'add' }),
  });

  assert.equal(loop.attempts[0].gradedPass, false, 'the wrong file must fail the real grader');
  assert.match(loop.attempts[0].gradeOutput, /AssertionError|expected 5/);
  assert.equal(loop.finalPass, true);
  assert.equal(loop.resolvedByRepair, true);

  // And a "confident" wrong file that never gets fixed stays failed.
  fs.writeFileSync(path.join(dir, solutionName), 'def add(a, b):\n    return a - b\n');
  let j = 0;
  const stuck = await runBoundedRepair({
    maxRepairs: 2,
    runAttempt: async () => ({ answer: 'This is now correct.' }), // no real change
    grade: async () => { j++; return gradeLocally({ sandboxDir: dir, solutionName, testName, entryPoint: 'add' }); },
  });
  assert.equal(stuck.finalPass, false, 'a claim without a real fix is not a pass');
  assert.equal(j, 3);

  fs.rmSync(dir, { recursive: true, force: true });
});

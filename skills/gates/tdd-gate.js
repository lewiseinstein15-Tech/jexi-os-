/**
 * JEXI OS — HARD GATE — TDD (the Iron Law, as code).
 *
 * BLOCKS any production-code write until a FAILING test exists — and the
 * gate does not take the agent's word for it: it RE-RUNS the test command
 * itself and requires a fresh non-zero exit observed by the gate. A passed
 * test, a claimed-but-unrun test, or a test that errors for setup reasons
 * the gate cannot distinguish → blocked.
 *
 * ctx.actionKind: 'test' | 'production'   ('test' writes are always allowed)
 * ctx.failingTest = {
 *   command: string,   // the focused test command, e.g. "node slugify.test.js"
 *   cwd: string
 * }
 */
import { spawnSync } from 'node:child_process';
import { appendAudit } from './state.js';

export default {
  id: 'tdd-gate',

  when: (ctx) => ctx?.actionKind === 'production',

  async check(ctx) {
    const ft = ctx?.failingTest;
    if (!ft || !ft.command) {
      return deny('no failing test', ['failing-test'],
        'Write the test FIRST and pass failingTest.command — the gate will re-run it and require a fresh non-zero exit before any production code is written.');
    }
    const res = spawnSync(String(ft.command), {
      cwd: ft.cwd || process.cwd(),
      shell: true,
      encoding: 'utf8',
      timeout: 60_000,
    });
    if (res.status === 0) {
      return deny('no failing test (the provided test command PASSED — a passing test proves nothing is missing)', ['failing-test'],
        'A green test cannot license new code. Write a test for the NEW behavior and watch it fail; the gate re-runs the command itself.');
    }
    const tail = `${res.stdout || ''}${res.stderr || ''}`.slice(-400).replace(/\s+/g, ' ').trim();
    appendAudit({ gate: 'tdd-gate', blocked: false, evidence: `failing test observed: "${ft.command}" exit=${res.status}` });
    return {
      allowed: true,
      reason: `failing test VERIFIED by gate: "${ft.command}" exited ${res.status} (expected for missing feature)`,
      observed: tail,
    };
  },
};

function deny(reason, missing, hint) {
  appendAudit({ gate: 'tdd-gate', blocked: true, reason, missing });
  return { allowed: false, reason, missing, hint };
}

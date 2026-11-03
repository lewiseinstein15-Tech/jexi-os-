/**
 * M20 — bounded test-driven repair loop (the reusable core).
 *
 * This is the ONE place the repair loop lives, so the benchmark driver and the
 * tests exercise the same code. The loop is deliberately small and has no
 * provider, filesystem or grader dependency of its own: the caller injects
 *   - `runAttempt({ attempt, ctx })` — run the agent once (attempt 0 = initial);
 *   - `grade()`                   — run the OFFICIAL grader once;
 *   - `makeRepairContext(...)`    — build the context (real failing-test output)
 *                                   handed to the next attempt.
 * That injection is the deterministic test seam; the real driver passes the
 * real agent loop and the real grader.
 *
 * Guarantees, enforced here rather than by convention:
 *   1. at most `maxRepairs` repair attempts after the first (default 2);
 *   2. the OFFICIAL grader decides every attempt — the model never grades
 *      itself, and an agent that merely claims success does not end the loop;
 *   3. a timeout or a grader error is NEVER a pass (via `scoreTask`);
 *   4. the loop stops the moment the grader passes, and reports honestly when
 *      the budget is exhausted.
 */
import { scoreTask } from './score.mjs';

export const MAX_REPAIRS = 2;

/**
 * @param {object} o
 * @param {number} [o.maxRepairs=2]        repairs allowed AFTER the first attempt
 * @param {(a:{attempt:number, ctx:any})=>Promise<{error?:string|null}>} o.runAttempt
 * @param {()=>Promise<{passed:boolean, output?:string, error?:string|null, exitCode?:number|null}>} o.grade
 * @param {(a:{attempt:number, previousGradeOutput:string, previousAgentError:string|null})=>any} [o.makeRepairContext]
 * @param {(rec:object)=>void} [o.onAttempt]
 * @returns {Promise<{finalPass:boolean, resolvedByRepair:boolean, attempts:object[]}>}
 */
export async function runBoundedRepair({ maxRepairs = MAX_REPAIRS, runAttempt, grade, makeRepairContext = () => ({}), onAttempt = () => {} }) {
  if (typeof runAttempt !== 'function') throw new TypeError('runBoundedRepair requires runAttempt');
  if (typeof grade !== 'function') throw new TypeError('runBoundedRepair requires grade');
  const cap = Math.max(0, Number(maxRepairs) || 0);
  const attempts = [];

  for (let attempt = 0; attempt <= cap; attempt++) {
    const prev = attempts[attempt - 1] || null;
    const ctx = attempt === 0 ? {} : makeRepairContext({
      attempt,
      previousGradeOutput: prev ? prev.gradeOutput : '',
      previousAgentError: prev ? prev.agentError : null,
    });

    const agentInfo = (await runAttempt({ attempt, ctx })) || {};
    const graded = (await grade()) || {};
    const scored = scoreTask({ graded, agentError: agentInfo.error || null });

    const record = {
      attempt,
      pass: scored.pass,
      gradedPass: graded.passed === true,
      agentTimedOut: scored.agentTimedOut,
      agentError: agentInfo.error || null,
      resolveReason: scored.reason,
      graderRan: graded.error == null,
      gradeOutput: String(graded.output || ''),
    };
    attempts.push(record);
    try { onAttempt(record); } catch { /* observer must not break the loop */ }

    if (scored.pass) return { finalPass: true, resolvedByRepair: attempt > 0, attempts };
  }
  return { finalPass: false, resolvedByRepair: false, attempts };
}

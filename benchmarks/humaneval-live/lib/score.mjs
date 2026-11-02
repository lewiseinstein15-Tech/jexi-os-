/**
 * JEXI OS — HumanEval benchmark scoring reconciliation (M17 / D3).
 *
 * A benchmark verdict must reflect the WHOLE task, not merely whether a
 * `solution.py` left on disk happens to grade green. M16 found bench4
 * HumanEval/3 recorded `pass=True` together with
 * `agentError="agent loop timed out after 300000ms"` — the grader ran the
 * leftover file and ignored the fact that the agent never finished. That
 * inflates every timed-out run and makes a pass-rate incomparable.
 *
 * The rule, in one place so the full run and the slice driver cannot drift:
 * a task is RESOLVED only when the agent loop completed without error AND the
 * grader actually ran AND the grader passed. Everything else is a failure, and
 * the reason is recorded so a timeout is never mistaken for a real miss (or,
 * worse, for a pass).
 */

/** Does this error string describe a timeout? */
export function isTimeoutError(err) {
  return /timed?\s*out|timeout/i.test(String(err || ''));
}

/**
 * Reconcile one task's grader result with the agent's own outcome.
 * @returns {{pass:boolean, reason:string|null, agentTimedOut:boolean, gradedPass:boolean}}
 */
export function scoreTask({ graded = {}, agentError = null } = {}) {
  const gradedPass = graded.passed === true;
  const agentTimedOut = isTimeoutError(agentError);
  if (graded.error) {
    return { pass: false, gradedPass, agentTimedOut, reason: `grader error: ${String(graded.error).slice(0, 200)}` };
  }
  if (agentError) {
    return { pass: false, gradedPass, agentTimedOut, reason: `${agentTimedOut ? 'timeout' : 'agent error'}: ${String(agentError).slice(0, 200)}` };
  }
  if (!gradedPass) {
    return { pass: false, gradedPass, agentTimedOut: false, reason: 'grader: solution did not pass' };
  }
  return { pass: true, gradedPass: true, agentTimedOut: false, reason: null };
}

/**
 * Roll per-task scores into the headline metrics. Kept separate so the
 * manifest can show a green-but-unresolved run for what it is.
 */
export function summarise(rows) {
  const total = rows.length;
  const resolved = rows.filter((r) => r.pass).length;
  const gradedGreen = rows.filter((r) => r.gradedPass).length;
  const timeouts = rows.filter((r) => r.agentTimedOut).length;
  const agentErrors = rows.filter((r) => r.agentError && !r.agentTimedOut).length;
  const graderErrors = rows.filter((r) => /^grader error/.test(String(r.resolveReason || ''))).length;
  return {
    total,
    resolved,
    resolvedRate: total ? resolved / total : 0,
    gradedGreen,
    gradedGreenRate: total ? gradedGreen / total : 0,
    timeouts,
    agentErrors,
    graderErrors,
    // green files that were NOT resolved — the exact overcount D3 caused.
    unresolvedGreen: rows.filter((r) => r.gradedPass && !r.pass).length,
  };
}

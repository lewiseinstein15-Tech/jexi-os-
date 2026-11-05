/**
 * JEXI OS — AGENT — intent classification.
 *
 * Split out of CodingLoop so that module stays small (JEXI-016 guards its
 * size) while the coding-turn heuristic can grow. CodingLoop re-exports these
 * names, so the public import surface is unchanged.
 */

/** Intents that must not be answered without real verification evidence.
 *  M12: includes the planner's real code_task/code_fix, which the cap missed. */
export const CODING_INTENTS = new Set(['code', 'coding', 'code_task', 'code_fix', 'fix', 'debug', 'refactor', 'test']);

/** Is this query a coding request by intent or by its own words? */
export function isCodingIntent(plan, query = '') {
  const intent = String(plan?.intent ?? '').toLowerCase();
  if (CODING_INTENTS.has(intent)) return true;
  const q = String(query ?? '');
  if (/\b(fix|repair|make .* pass|failing (test|pytest)|broken|bug|debug|refactor|implement|add a test)\b/i.test(q)) return true;
  /* M21 — a request that CARRIES CODE is a coding turn even when the planner
     returned no intent and the sentence dodges every word above. The HumanEval
     harness is exactly this shape — "Complete this Python function … writing
     the full implementation … <fenced python block> … confirm it passes" — and
     was misclassified as a plain answer, so neither the first-round tool force
     nor the closed coding loop armed. Three conservative, code-specific
     signals (not a bare language mention, which a plain question may carry):
       - a language-tagged fenced code block in the request;
       - a produce verb within a short window of a code noun;
       - explicit test-suite language. */
  if (/```[a-zA-Z][a-zA-Z0-9_+-]*\s*\n/.test(q)) return true;
  if (/\b(write|create|complete|implement|add|produce|generate|port|translate|build|output|save)\b[\s\S]{0,60}\b(function|method|class|module|script|file|program|implementation|algorithm|code|endpoint|api|test)\b/i.test(q)) return true;
  if (/\b(pytest|unittest|jest|mocha|test suite|unit tests?|test file|tests? pass|failing test)\b/i.test(q)) return true;
  return false;
}

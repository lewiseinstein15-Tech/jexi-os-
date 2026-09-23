/**
 * JEXI OS — benchmarks/gaia/score.js
 *
 * GAIA normalized exact match, per the Phase 31 Scope 11 spec:
 *   lowercase, trim, strip thousands-separators, strip currency
 *   symbols, collapse internal whitespace, then binary comparison.
 *
 * Notes on fidelity to the official GAIA scorer:
 * - The official scorer additionally treats purely-numeric ground
 *   truths as floats and splits comma/semicolon lists. Scope 11 ships
 *   the spec'd normalizer + string equality (binary per task, no
 *   partial credit). The float/list branches are deferred with the
 *   live run (scope 17) and are NOT silently emulated here.
 * - Trailing sentence period(s) are trimmed because the official
 *   normalizer is punctuation-insensitive on answer tails; without
 *   this, "Paris." would fail against "Paris".
 *
 * Deterministic: no Date, no Math.random, no I/O.
 */

const CURRENCY_SYMBOLS = /[$€£¥₹]/g;

/** A thousands-separator comma = a comma immediately followed by
 *  exactly three digits that are not part of a longer digit run
 *  (e.g. "1,000", "12,345,678", "1,234.56"; NOT "a, b", NOT "1,23"). */
const THOUSANDS_SEPARATOR = /,(?=\d{3}(?!\d))/g;

export function normalizeAnswer(input) {
  let s = input === null || input === undefined ? '' : String(input);
  s = s.toLowerCase();                 // 1. case-fold
  s = s.replace(CURRENCY_SYMBOLS, ''); // 2. strip currency symbols
  s = s.replace(THOUSANDS_SEPARATOR, ''); // 3. strip thousands-separator commas
  s = s.replace(/\s+/g, ' ').trim();   // 4. collapse internal whitespace + trim
  s = s.replace(/\.+$/, '');           // 5. strip trailing sentence period(s)
  return s.trim();
}

/** gaia.score(task, answer) -> { pass: bool, normalized, expected }
 *  Binary per task. No partial credit. */
export function score(task, answer) {
  if (!task || typeof task.final_answer !== 'string') {
    const err = new Error('gaia.score: task.final_answer (string) is required');
    err.code = 'GAIA_SCORE_BAD_TASK';
    throw err;
  }
  const expected = normalizeAnswer(task.final_answer);
  const normalized = normalizeAnswer(answer);
  return { pass: normalized === expected, normalized, expected };
}

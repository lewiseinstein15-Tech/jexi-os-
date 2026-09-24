/**
 * JEXI OS — benchmarks/terminal-bench/observation.js
 *
 * tb.observe(raw) -> { stdout, exitCode, cwd }
 *
 * `raw` is the terminal observation as captured by the runner side:
 *   { stdout: <raw pane text, ANSI allowed>, exitCode?: number|null, cwd?: string|null }
 *
 * Normalization contract (frozen):
 * - ANSI escape sequences are stripped: CSI forms (ESC[ ... final byte),
 *   OSC forms (ESC] ... BEL or ESC\), and two-byte ESC sequences;
 * - EVERYTHING else is preserved byte-for-byte: trailing whitespace,
 *   carriage returns, and consecutive blank lines are NOT collapsed —
 *   a diff of (raw minus escapes) to (parsed stdout) is empty;
 * - the exit code stays a separate number (never merged into the text),
 *   defaulting to null when the capture carried none;
 * - cwd stays a separate string (or null).
 *
 * agent.step() consumes exactly this shape. Misuse (non-object raw,
 * non-string stdout, wrong-typed exitCode/cwd) throws
 * E_INVALID_OBSERVATION rather than silently coercing.
 *
 * Deterministic: pure string processing, no wall-clock, no randomness.
 */

// Matches, in alternation order (longest/most specific first):
//   1. CSI sequences: ESC [ params(0-9 ; ?)* intermediates(0x20-0x2F)* final(0x40-0x7E)
//   2. OSC sequences: ESC ] ... BEL (0x07) or ST (ESC \)
//   3. two-byte ESC sequences: ESC followed by a single byte 0x40-0x7E
//      (ESC 7 save-cursor, ESC c reset, ESC = keypad-app, ...). Because
//      alternation is ordered, ESC[ and ESC] input is fully consumed by
//      branches 1/2 and never leaks into branch 3.
const ANSI_RE = /\u001B(?:\[[0-9;?]*[ -/]*[@-~]|\][^\u0007\u001B]*(?:\u0007|\u001B\\)|[@-~])/g;

/** Strip ANSI escape sequences from a string; non-strings pass through. */
export function stripAnsi(text) {
  return typeof text === 'string' ? text.replace(ANSI_RE, '') : text;
}

function invalidObservation(reason) {
  const err = new Error(`E_INVALID_OBSERVATION — ${reason}`);
  err.code = 'E_INVALID_OBSERVATION';
  return err;
}

/**
 * Normalize one captured terminal observation into the exact shape
 * agent.step() consumes: { stdout, exitCode, cwd }.
 */
export function observe(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw invalidObservation('raw observation must be an object { stdout, exitCode?, cwd? }');
  }
  if (typeof raw.stdout !== 'string') {
    throw invalidObservation('stdout must be a string (raw captured pane text, ANSI allowed)');
  }
  const exitCode = raw.exitCode === undefined ? null : raw.exitCode;
  if (exitCode !== null && typeof exitCode !== 'number') {
    throw invalidObservation('exitCode must be a number or null/undefined');
  }
  const cwd = raw.cwd === undefined ? null : raw.cwd;
  if (cwd !== null && typeof cwd !== 'string') {
    throw invalidObservation('cwd must be a string or null/undefined');
  }
  return { stdout: stripAnsi(raw.stdout), exitCode, cwd };
}

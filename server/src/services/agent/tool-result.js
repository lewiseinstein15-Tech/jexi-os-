/**
 * JEXI OS — AGENT — tool-result shaping.
 *
 * Split out of CodingLoop (JEXI-016 guards that module's size); re-exported
 * from CodingLoop so the import surface is unchanged.
 */

/** JEXI-014 — tool results were sliced to a flat 6000 chars, which cut the
 *  pytest traceback (always at the END of the output) off exactly when it
 *  mattered. This keeps a head AND a tail, with the tail biased toward the
 *  assertion/failure lines. */
export function shapeToolResult(text, { maxChars = 6000, isTestResult = false } = {}) {
  const s = String(text ?? '');
  if (s.length <= maxChars) return s;
  const headChars = Math.floor(maxChars * 0.3);
  const tailChars = maxChars - headChars - 120;
  const head = s.slice(0, headChars);
  const tail = s.slice(-tailChars);
  const elided = s.length - head.length - tail.length;

  if (isTestResult) {
    // Put the structured failure lines first so they survive any later slicing.
    const lines = s.split('\n');
    const signal = lines
      .filter((l) => /^(FAILED|ERROR)\s|^E\s+|^>+\s|\bassert\b|Traceback|short test summary|^\d+ (passed|failed)|\d+ failed,|\d+ passed,/.test(l))
      .slice(0, 60);
    const signalBlock = signal.length ? `\n\n--- key lines (failures/assertions) ---\n${signal.join('\n')}\n` : '';
    return `${head}\n\n…[${elided} chars elided]…${signalBlock}\n--- tail ---\n${tail}`;
  }
  return `${head}\n\n…[${elided} chars elided — the failure detail is in the tail below]…\n\n${tail}`;
}

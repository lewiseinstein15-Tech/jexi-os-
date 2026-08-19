/**
 * B144 — OUTPUT RETENTION (DeepSeek Harness `packages/util/output-retention`
 * mirror, JEXI-branded).
 *
 * Retention policy for model-facing outputs: char budgets per surface
 * (tool output, subagent summary, ralph handoff, log tail), truncation with
 * the DSH clipped note, and a head+tail keeper so the beginning AND end of
 * long outputs survive.
 */

export const RETENTION_BUDGETS = {
  toolOutput: 12000,
  subagentSummary: 350,
  ralphHandoff: 16384,
  ralphResult: 16384,
  logTail: 4000,
  spillThreshold: 14000,
};

const CLIPPED = '<response clipped><NOTE>Output truncated by the retention policy.</NOTE>';

/** Keep head+tail of text within a budget (middle dropped with a marker). */
export function retainHeadTail(text, budget = RETENTION_BUDGETS.toolOutput, { headRatio = 0.6 } = {}) {
  const s = String(text ?? '');
  if (s.length <= budget) return { text: s, truncated: false };
  const head = Math.floor(budget * headRatio);
  const tail = budget - head - CLIPPED.length;
  return {
    text: s.slice(0, head) + CLIPPED + (tail > 0 ? s.slice(-tail) : ''),
    truncated: true,
  };
}

/** Simple head truncation (for log tails). */
export function retainTail(text, budget = RETENTION_BUDGETS.logTail) {
  const s = String(text ?? '');
  if (s.length <= budget) return { text: s, truncated: false };
  return { text: s.slice(-budget), truncated: true };
}

/** Retention policy status for /api/retention. */
export function retentionStatus() {
  return { ok: true, budgets: RETENTION_BUDGETS, clippedNote: CLIPPED };
}

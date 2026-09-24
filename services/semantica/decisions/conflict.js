/**
 * JEXI OS — Phase 14 Scope C — conflict detection.
 *
 *   conflicts(log, { subject? }) -> [ { a, b, reason } ]
 *
 * Two decisions on the SAME subject whose `chosen` values differ are
 * a conflict (contradicting outcomes). Same subject + same chosen is
 * NOT a conflict (re-affirmation). Pairs are emitted in append order
 * (i < j), so output is deterministic.
 */
export function conflicts(log, { subject } = {}) {
  const ds = subject === undefined ? log.list() : log.list({ subject });
  const out = [];
  for (let i = 0; i < ds.length; i += 1) {
    for (let j = i + 1; j < ds.length; j += 1) {
      const a = ds[i];
      const b = ds[j];
      if (a.subject === b.subject && a.chosen !== b.chosen) {
        out.push({
          a: a.decisionId,
          b: b.decisionId,
          reason: `same subject "${a.subject}" with contradicting chosen: "${a.chosen}" vs "${b.chosen}"`,
        });
      }
    }
  }
  return out;
}

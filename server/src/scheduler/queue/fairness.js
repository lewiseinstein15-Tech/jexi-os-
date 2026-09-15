/**
 * JEXI OS — Phase 6 Scope B: scheduler queue — fairness.
 *
 * Priority alone lets a busy high-priority class starve everything else. The
 * fairness selector keeps a per-`lane` credit ledger: every time a lane is
 * picked its credit drops; lanes that have waited longest accrue credit. The
 * next pick is the highest-priority candidate among lanes with the fewest
 * recent picks, so no lane is starved indefinitely.
 */

/**
 * @param {Array<{ lane: string, priority?: number }>} candidates in queue order
 * @param {{ picks?: Map<string, number>, weight?: number }} state
 * @returns {number} index into `candidates`, or -1 when empty
 */
export function selectFairIndex(candidates, state = {}) {
  if (!candidates || candidates.length === 0) return -1;
  const picks = state.picks || new Map();

  // Fewest previous picks wins first (round-robin-ish), then priority, then order.
  let best = 0;
  for (let i = 1; i < candidates.length; i++) {
    const a = candidates[i];
    const b = candidates[best];
    const pa = picks.get(a.lane) || 0;
    const pb = picks.get(b.lane) || 0;
    if (pa < pb) { best = i; continue; }
    if (pa > pb) continue;
    if ((a.priority || 0) > (b.priority || 0)) best = i;
  }
  return best;
}

/** Record that `lane` was served. */
export function recordPick(picks, lane) {
  picks.set(lane, (picks.get(lane) || 0) + 1);
  return picks;
}

/** Snapshot of lane credits (picks per lane, descending). */
export function fairnessSnapshot(pickCounts) {
  return [...pickCounts.entries()]
    .map(([lane, count]) => ({ lane, picks: count }))
    .sort((a, b) => b.picks - a.picks);
}

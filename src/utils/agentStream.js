/**
 * B205 — ARENA-STYLE AGENT STREAM: pure helpers for the unified thinking
 * panel. No React imports so the server test suite can unit-test them
 * (server/test-b205.js) — the same trick as the B199e/B202 planner rules.
 *
 * The panel replaces the old scattered trio (ThinkRow + NarrationFeed +
 * chat-inline ActionFeed/AgentPipeline) with ONE collapsible block per
 * assistant message, in the Arena-agent pattern:
 *
 *   live:   ✻ Thinking · 12.3s          (open, auto-scrolling)
 *             narrations — her first-person voice
 *             activity  — compact agent/tool rows
 *             reasoning — raw think tokens, dimmed
 *   done:   ✻ Thought for 12s · 8 agents · 10 sources   ▸  (collapsed)
 */

/** Collapse exact-consecutive duplicate activity rows (rotation retries
 *  spam the same line; the trace should read like a story, not a loop). */
export function dedupeActivity(rows) {
  const out = [];
  for (const r of rows || []) {
    const last = out[out.length - 1];
    if (last && last.agent === r.agent && last.message === r.message) continue;
    out.push(r);
  }
  return out;
}

/** Unique agent names across the activity trace. */
export function countAgents(rows) {
  const names = new Set((rows || []).map((r) => String(r.agent || '').trim() || 'JEXI'));
  return names.size;
}

/** Count real tool/action rows (log lines that carry an agent doing work). */
export function countSteps(rows) {
  return (rows || []).length;
}

/** mm:ss / s formatting for the header timer. */
export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const r = Math.round(s - m * 60);
  return `${m}m ${String(r).padStart(2, '0')}s`;
}

/** Stats chips for the collapsed header: agents · sources · steps. */
export function traceChips({ activity, sourceCount, narrations } = {}) {
  const rows = dedupeActivity(activity);
  const chips = [];
  const agents = countAgents(rows);
  if (agents) chips.push(`${agents} agent${agents === 1 ? '' : 's'}`);
  if (narrations && narrations.length) chips.push(`${narrations.length} note${narrations.length === 1 ? '' : 's'}`);
  if (sourceCount) chips.push(`${sourceCount} source${sourceCount === 1 ? '' : 's'}`);
  const steps = countSteps(rows);
  if (steps) chips.push(`${steps} step${steps === 1 ? '' : 's'}`);
  return chips;
}

/** Does this message carry a visible thinking trace at all? (Direct answers
 *  with no narrations/activity/reasoning stay clean — no empty panel.) */
export function hasTrace(msg) {
  const { narrations, activity, thinking } = msg || {};
  return Boolean(
    (narrations && narrations.length)
    || (activity && activity.length)
    || (thinking && String(thinking).trim())
  );
}

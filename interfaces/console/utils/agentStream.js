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

/* ------------------------------------------------------------------------
 * B206 — THINKING-PANEL HARDENING.
 * The panel renders LIVE, UNTRUSTED server data. One malformed event must
 * never blank the chat: objects as React children throw ("Objects are not
 * valid as a React child"), control characters/ANSI codes render as junk,
 * and a marathon task can emit hundreds of rows. Everything below is
 * defensive: coerce, strip, cap.
 * ------------------------------------------------------------------------ */

const CTRL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g; // C0 except \n \t
const ANSI_RE = /\u001B\[[0-9;?]*[A-Za-z]/g;

/** Coerce anything into safe display text: string, controls + ANSI stripped,
 *  length capped. Objects become a harmless "[object Object]"-style string
 *  instead of crashing React. */
export function sanitizeText(v, maxChars = 4000) {
  let s = v === null || v === undefined ? '' : String(v);
  s = s.replace(ANSI_RE, '').replace(CTRL_RE, '');
  if (s.length > maxChars) s = `…${s.slice(-(maxChars - 1))}`;
  return s;
}

/** Coerce raw activity rows into a safe shape; invalid entries are dropped. */
export function safeRows(rows) {
  if (!Array.isArray(rows)) return [];
  const out = [];
  for (const r of rows) {
    if (r === null || r === undefined) continue;
    const agent = sanitizeText(r.agent, 40).trim() || 'JEXI';
    const message = sanitizeText(r.message, 240);
    if (message) out.push({ agent, message });
  }
  return out;
}

/** Keep the TAIL of a long list for rendering: { shown, hidden }.
 *  A 500-step marathon task renders the last 40 rows + "+460 earlier steps",
 *  never a 500-node DOM subtree that re-renders 10×/s. */
export function capTail(arr, limit = 40) {
  const list = Array.isArray(arr) ? arr : [];
  if (list.length <= limit) return { shown: list, hidden: 0 };
  return { shown: list.slice(-limit), hidden: list.length - limit };
}

/** Cap a huge text blob for display, keeping the newest TAIL (live streams
 *  care about what just happened). */
export function capText(text, maxChars = 6000) {
  const s = sanitizeText(text, maxChars + 1000);
  if (s.length <= maxChars) return s;
  return `…${s.slice(-(maxChars - 1))}`;
}

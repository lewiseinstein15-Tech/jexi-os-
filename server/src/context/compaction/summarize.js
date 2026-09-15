/**
 * JEXI OS — Phase 6 Scope C: context manager — bounded compaction.
 *
 * Deterministic extractive summarization of an event/message range, used when
 * a range is too long to keep verbatim. No model call: it keeps the earliest
 * and latest lines as anchors and samples the middle, so a compacted block is
 * faithful (never invents content) and bounded.
 */

/**
 * @param {Array<string|{content?:string,text?:string,role?:string}>} events
 * @param {{ maxChars?: number, headCount?: number, tailCount?: number }} opts
 */
export function compactRange(events = [], { maxChars = 1200, headCount = 3, tailCount = 3 } = {}) {
  const lines = (events || [])
    .map((e) => {
      if (typeof e === 'string') return e.trim();
      const role = e.role ? `${e.role}: ` : '';
      return `${role}${String(e.content ?? e.text ?? '').trim()}`;
    })
    .filter(Boolean);

  if (lines.length === 0) return { summary: '', omitted: 0, kept: 0 };
  const full = lines.join('\n');
  if (full.length <= maxChars) return { summary: full, omitted: 0, kept: lines.length };

  const head = lines.slice(0, headCount);
  const tail = lines.slice(-tailCount);
  const middle = lines.slice(headCount, lines.length - tailCount);
  const omitted = middle.length;

  const footNote = `… ${omitted} earlier event${omitted === 1 ? '' : 's'} compacted …`;
  let summary = [...head, footNote, ...tail].join('\n');
  if (summary.length > maxChars) summary = `${summary.slice(0, maxChars - 1)}…`;
  return { summary, omitted, kept: head.length + tail.length };
}

const compactionHooks = [];

/** Register a custom compactor. The last-registered hook that returns a value wins. */
export function registerCompactor(fn) {
  compactionHooks.push(fn);
  return () => {
    const i = compactionHooks.indexOf(fn);
    if (i >= 0) compactionHooks.splice(i, 1);
  };
}

/**
 * Compact with hooks applied first (a model-backed or store-backed compactor),
 * falling back to the deterministic extractive range.
 */
export async function compact(events = [], opts = {}) {
  for (let i = compactionHooks.length - 1; i >= 0; i--) {
    try {
      const out = await compactionHooks[i](events, opts);
      if (out && typeof out.summary === 'string') return out;
    } catch { /* a failing hook falls through to the deterministic path */ }
  }
  return compactRange(events, opts);
}

/** Pressure: how full a context is, as a ratio in [0,1] plus a state label. */
export function contextPressure(usedTokens, budgetTokens) {
  const used = Math.max(0, Number(usedTokens) || 0);
  const cap = Math.max(1, Number(budgetTokens) || 1);
  const ratio = used / cap;
  const state = ratio >= 1 ? 'over' : ratio >= 0.85 ? 'hot' : ratio >= 0.6 ? 'warm' : 'cool';
  return { used, cap, ratio: Math.round(ratio * 1000) / 1000, state };
}
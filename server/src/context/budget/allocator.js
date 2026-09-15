/**
 * JEXI OS — Phase 6 Scope C: context manager — token budget allocator.
 *
 * A context window is a scarce resource. The allocator hands ordered sections
 * a share of a total budget in priority order (higher first), clipping any
 * section that overruns its share and dropping the lowest-priority sections
 * that don't fit at all. `keep` sections are never dropped.
 *
 * Budgets are enforced in BOTH characters and estimated tokens, using the
 * existing TokenMeter so the split matches the rest of the system.
 */

import { estimateTokens } from '../../services/TokenMeter.js';

/** Pro-rata split of `total` across weighted sections. */
export function allocateBudget(sections = [], total = 8000) {
  const cap = Math.max(1, Number(total) || 8000);
  const weights = sections.map((s) => Math.max(0, Number(s.weight ?? 1) || 0));
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  return sections.map((s, i) => ({ name: s.name, share: Math.max(0, Math.floor((weights[i] / sum) * cap)) }));
}

/**
 * Clip + drop to fit the budget.
 * @param {Array<{name,content,priority?,weight?,keep?}>} sections
 * @param {{maxChars?:number,maxTokens?:number,perSectionChars?:number}} budget
 */
export function clipToBudget(sections = [], budget = {}) {
  const maxChars = Number(budget.maxChars) || 24000;
  const maxTokens = Number(budget.maxTokens) || 8000;
  const perSectionChars = Math.min(Number(budget.perSectionChars) || maxChars, maxChars);

  const kept = (sections || [])
    .map((s, i) => ({
      name: s.name || `section-${i}`,
      content: String(s.content || '').trim(),
      priority: Number.isFinite(s.priority) ? s.priority : 0,
      keep: !!s.keep,
      order: i,
    }))
    .filter((s) => s.content)
    .sort((a, b) => (b.priority - a.priority) || (a.order - b.order));

  const clipped = [];
  for (const s of kept) {
    if (s.content.length > perSectionChars) {
      s.content = `${s.content.slice(0, perSectionChars)}…`;
      clipped.push(s.name);
    }
  }

  const sizeOf = (list) => {
    const text = list.map((s) => s.content).join('\n');
    return { chars: text.length, tokens: estimateTokens(text) };
  };

  // Drop lowest priority (then latest ordered) non-keep sections until it fits.
  const dropped = [];
  let live = kept.slice();
  const over = () => { const s = sizeOf(live); return s.chars > maxChars || s.tokens > maxTokens; };
  while (over() && live.length > 1) {
    let idx = -1;
    for (let i = live.length - 1; i >= 0; i--) {
      if (!live[i].keep) { idx = i; break; }
    }
    if (idx < 0) break;
    dropped.push(live[idx].name);
    live.splice(idx, 1);
  }

  // Restore original order for a stable, readable prompt.
  live.sort((a, b) => a.order - b.order);
  const size = sizeOf(live);
  return {
    sections: live,
    clipped,
    dropped,
    chars: size.chars,
    tokens: size.tokens,
    overBudget: size.chars > maxChars || size.tokens > maxTokens,
  };
}
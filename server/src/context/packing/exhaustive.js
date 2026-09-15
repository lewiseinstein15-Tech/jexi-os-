/**
 * JEXI OS — Phase 6 Scope C: context manager — exhaustiveness packing.
 *
 * "Packing" answers: given a budget, how many items fit? Used to decide how
 * many memory hits / previous results to include. Deterministic and greedy:
 * highest score first, stop when the next item would exceed the cap.
 */

import { estimateTokens } from '../../services/TokenMeter.js';

/**
 * @param {Array<{ id?: string, text?: string, content?: string, score?: number }>} items
 * @param {{ maxTokens?: number, maxItems?: number, separator?: string }} opts
 */
export function packItems(items = [], { maxTokens = 2000, maxItems = 50, separator = '\n' } = {}) {
  const ordered = items
    .map((it, i) => ({ it, i, score: Number.isFinite(it.score) ? it.score : 0, text: String(it.text ?? it.content ?? '') }))
    .filter((x) => x.text)
    .sort((a, b) => (b.score - a.score) || (a.i - b.i));

  const chosen = [];
  let used = 0;
  let overflowed = false;
  for (const x of ordered) {
    if (chosen.length >= maxItems) { overflowed = true; break; }
    const add = estimateTokens(x.text) + (chosen.length ? estimateTokens(separator) : 0);
    if (used + add > maxTokens) { overflowed = true; break; }
    used += add;
    chosen.push(x);
  }
  chosen.sort((a, b) => a.i - b.i);

  return {
    items: chosen.map((c) => c.it),
    text: chosen.map((c) => c.text).join(separator),
    fit: chosen.length,
    considered: ordered.length,
    overflowed,
    tokens: used,
  };
}
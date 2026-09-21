/**
 * JEXI OS — Phase 16 Scope B — Narration: completion
 * "Done. Here's what I built"
 */

export function build(ctx = {}) {
  const built = ctx.built || ctx.result || ctx.artifact || ctx.feature || '';
  const summary = ctx.summary || ctx.details || '';
  const builtPart = built ? `: ${String(built).slice(0, 200)}` : '';
  const summaryPart = summary ? ` — ${String(summary).slice(0, 200)}` : '';
  return `Done. Here's what I built${builtPart}${summaryPart}`;
}

export default { build };

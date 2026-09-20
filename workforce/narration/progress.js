/**
 * JEXI OS — Phase 16 Scope B — Narration: progress
 * "Running tests... 2 of 5 passing"
 */

export function build(ctx = {}) {
  const current = ctx.current ?? ctx.done ?? ctx.completed ?? 2;
  const total = ctx.total ?? ctx.steps ?? 5;
  const passing = ctx.passing ?? ctx.pass ?? '';
  const message = ctx.message || ctx.status || '';

  const curStr = String(current);
  const totalStr = String(total);
  const passingPart = passing ? `, ${passing} passing` : ' passing';
  const msgPart = message ? ` — ${String(message).slice(0, 120)}` : '';

  // Example: "Running tests... 2 of 5 passing"
  // If ctx provides custom text, use it but still constructed
  if (ctx.text && typeof ctx.text === 'string' && ctx.text.length > 0) {
    // Still construct, not just return placeholder
    return `Running ${String(ctx.text).slice(0, 150)}... ${curStr} of ${totalStr}${passingPart}${msgPart}`;
  }

  return `Running tests... ${curStr} of ${totalStr}${passingPart}${msgPart}`;
}

export default { build };

/**
 * JEXI OS — Phase 16 Scope B — Narration: correction
 * "That didn't work. Trying Z instead"
 */

export function build(ctx = {}) {
  const error = ctx.error || ctx.reason || ctx.failure || '';
  const next = ctx.next || ctx.alternative || ctx.try || ctx.retry || 'a different approach';
  const errorPart = error ? ` — ${String(error).slice(0, 120)}` : '';
  const nextStr = String(next).slice(0, 150);
  return `That didn't work${errorPart}. Trying ${nextStr} instead`;
}

export default { build };

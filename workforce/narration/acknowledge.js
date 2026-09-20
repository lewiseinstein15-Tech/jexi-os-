/**
 * JEXI OS — Phase 16 Scope B — Narration: acknowledge
 * "I understand - you want X"
 */

export function build(ctx = {}) {
  const want = ctx.input || ctx.want || ctx.task || ctx.goal || ctx.description || 'to proceed';
  const wantStr = typeof want === 'string' ? want : JSON.stringify(want);
  // Construct text from ctx fields, no placeholders left
  const trimmed = wantStr.slice(0, 200);
  return `I understand - you want ${trimmed}`;
}

export default { build };

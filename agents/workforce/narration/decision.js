/**
 * JEXI OS — Phase 16 Scope B — Narration: decision
 * "I'll build X that matches Y pattern"
 */

export function build(ctx = {}) {
  const buildTarget = ctx.build || ctx.target || ctx.feature || ctx.task || 'the requested feature';
  const pattern = ctx.pattern || ctx.existing || ctx.reference || ctx.style || 'existing';
  const buildStr = String(buildTarget).slice(0, 120);
  const patternStr = String(pattern).slice(0, 120);
  return `I'll build ${buildStr} that matches ${patternStr} pattern`;
}

export default { build };

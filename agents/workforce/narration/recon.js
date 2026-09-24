/**
 * JEXI OS — Phase 16 Scope B — Narration: recon
 * "Let me check the existing code first"
 */

export function build(ctx = {}) {
  const src = ctx.source || ctx.file || ctx.path || ctx.target || 'existing code';
  const srcStr = typeof src === 'string' ? src : JSON.stringify(src);
  const trimmed = srcStr.slice(0, 120);
  if (ctx.source) {
    return `Let me check the existing code first — looking at ${trimmed}`;
  }
  return `Let me check the existing code first — ${trimmed}`;
}

export default { build };

/**
 * JEXI OS — Phase 16 Scope B — Narration: finding
 * "Found Y. Here's what I see"
 */

export function build(ctx = {}) {
  const found = ctx.found || ctx.file || ctx.result || ctx.discovery || 'relevant code';
  const foundStr = typeof found === 'string' ? found : JSON.stringify(found);
  const trimmed = foundStr.slice(0, 150);
  const details = ctx.details || ctx.summary || ctx.observation || '';
  const detailsStr = details ? ` — ${String(details).slice(0, 150)}` : '';
  return `Found ${trimmed}. Here's what I see${detailsStr}`;
}

export default { build };

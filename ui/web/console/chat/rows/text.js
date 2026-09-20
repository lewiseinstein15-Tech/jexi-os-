/**
 * JEXI OS — Phase 16 Scope C — Row: text
 * white — #f3eee6 (jcx-ink)
 * Maps: message.delta, plan.created, plan.updated, artifact.created, checkpoint.created
 */

export const rowType = 'text';

export const style = {
  color: '#f3eee6', // --jcx-ink from src/styles/jexi-theme.css
  weight: 400,
  italic: false,
  monospace: false,
};

export function render(event) {
  const p = event?.payload || {};
  if (typeof p.delta === 'string') return p.delta;
  if (typeof p.text === 'string') return p.text;
  if (typeof p.title === 'string') return p.title;
  if (typeof p.path === 'string') return p.path;
  if (typeof p.checkpointId === 'string') return `checkpoint: ${p.checkpointId}`;
  if (typeof p.planId === 'string' && Array.isArray(p.steps)) return `${p.planId}: ${p.steps.length} steps`;
  if (typeof p.content === 'string') return p.content.slice(0, 1000);
  // Fallback stringify
  try {
    return JSON.stringify(p).slice(0, 1000);
  } catch {
    return String(p);
  }
}

export default { rowType, style, render };

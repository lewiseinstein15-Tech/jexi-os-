/**
 * JEXI OS — Phase 16 Scope C — Row: thinking
 * muted italic — #7a7163 (jcx-ink-3)
 */

export const rowType = 'thinking';

export const style = {
  color: '#7a7163', // --jcx-ink-3 from src/styles/jexi-theme.css
  weight: 400,
  italic: true,
  monospace: false,
};

export function render(event) {
  const p = event?.payload || {};
  if (typeof p.delta === 'string') return p.delta;
  if (typeof p.thinking === 'string') return p.thinking;
  if (typeof p.text === 'string') return p.text;
  return JSON.stringify(p).slice(0, 1000);
}

export default { rowType, style, render };

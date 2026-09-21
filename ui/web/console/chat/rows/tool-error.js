/**
 * JEXI OS — Phase 16 Scope C — Row: tool-error
 * red — #ff5d5d (jcx-down)
 */

export const rowType = 'tool-error';

export const style = {
  color: '#ff5d5d', // --jcx-down from src/styles/jexi-theme.css
  weight: 600,
  italic: false,
  monospace: true,
};

export function render(event) {
  const p = event?.payload || {};
  if (p.error) {
    if (typeof p.error === 'string') return p.error;
    if (p.error.message) return p.error.message;
    try {
      return JSON.stringify(p.error);
    } catch {
      return String(p.error);
    }
  }
  if (typeof p.message === 'string') return p.message;
  return JSON.stringify(p).slice(0, 1000);
}

export default { rowType, style, render };

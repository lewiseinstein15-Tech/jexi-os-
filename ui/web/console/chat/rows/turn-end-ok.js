/**
 * JEXI OS — Phase 16 Scope C — Row: turn-end-ok
 * green — #4cc38a (jcx-up)
 */

export const rowType = 'turn-end-ok';

export const style = {
  color: '#4cc38a', // --jcx-up from src/styles/jexi-theme.css
  weight: 600,
  italic: false,
  monospace: false,
};

export function render(event) {
  const p = event?.payload || {};
  return `turn completed: ${p.turnId || ''} ${p.summary || p.status || 'ok'}`.trim();
}

export default { rowType, style, render };

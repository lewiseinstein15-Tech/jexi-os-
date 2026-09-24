/**
 * JEXI OS — Phase 16 Scope C — Row: turn-end-fail
 * red — #ff5d5d (jcx-down)
 */

export const rowType = 'turn-end-fail';

export const style = {
  color: '#ff5d5d', // --jcx-down from src/styles/jexi-theme.css
  weight: 600,
  italic: false,
  monospace: false,
};

export function render(event) {
  const p = event?.payload || {};
  return `turn failed: ${p.turnId || ''} ${p.summary || p.status || 'fail'}`.trim();
}

export default { rowType, style, render };

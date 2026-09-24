/**
 * JEXI OS — Phase 16 Scope C — Row: narration
 * accent — #ff7a3d (jcx-ember)
 */

export const rowType = 'narration';

export const style = {
  color: '#ff7a3d', // --jcx-ember from src/styles/jexi-theme.css
  weight: 500,
  italic: false,
  monospace: false,
};

export function render(event) {
  const p = event?.payload || {};
  if (typeof p.text === 'string') return p.text;
  if (typeof p.narrationType === 'string' && typeof p.input === 'string') return `${p.narrationType}: ${p.input}`;
  return JSON.stringify(p).slice(0, 1000);
}

export default { rowType, style, render };

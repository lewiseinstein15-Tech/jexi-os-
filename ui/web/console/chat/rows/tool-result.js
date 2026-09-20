/**
 * JEXI OS — Phase 16 Scope C — Row: tool-result
 * muted, collapsible if long — #a99f90 (jcx-ink-2)
 */

export const rowType = 'tool-result';

export const style = {
  color: '#a99f90', // --jcx-ink-2 from src/styles/jexi-theme.css
  weight: 400,
  italic: false,
  monospace: true,
};

const COLLAPSE_THRESHOLD = 500;

export function render(event) {
  const p = event?.payload || {};
  let content = '';

  if (p.result !== undefined) {
    if (typeof p.result === 'string') content = p.result;
    else {
      try {
        content = JSON.stringify(p.result);
      } catch {
        content = String(p.result);
      }
    }
  } else if (p.content !== undefined) {
    content = String(p.content);
  } else {
    content = JSON.stringify(p).slice(0, 10000);
  }

  // Long content gets collapsible marker (plain ASCII, no HTML tags)
  if (content.length > COLLAPSE_THRESHOLD) {
    // ASCII indicator: [+ N chars collapsed]
    return `${content.slice(0, COLLAPSE_THRESHOLD)} ... [+${content.length} chars collapsed]`;
  }

  return content;
}

export default { rowType, style, render };

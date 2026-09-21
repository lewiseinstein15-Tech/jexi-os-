/**
 * JEXI OS — Phase 16 Scope C — Row: tool-use
 * cyan (spec) -> #ffb88c (jcx-peach) token from src/styles/jexi-theme.css — closest accent
 * "Name(args)" with args truncated to 80 chars max
 */

export const rowType = 'tool-use';

export const style = {
  color: '#ffb88c', // --jcx-peach from src/styles/jexi-theme.css (real token, spec says cyan)
  weight: 600,
  italic: false,
  monospace: true,
};

function truncateArgs(argsStr) {
  if (argsStr.length <= 80) return argsStr;
  return argsStr.slice(0, 80) + '...';
}

export function render(event) {
  const p = event?.payload || {};
  const name = p.toolName || p.name || p.tool || 'tool';
  let argsStr = '';

  if (p.args !== undefined) {
    try {
      argsStr = typeof p.args === 'string' ? p.args : JSON.stringify(p.args);
    } catch {
      argsStr = String(p.args);
    }
  } else if (p.message) {
    argsStr = String(p.message);
  } else if (p.progress !== undefined) {
    argsStr = `progress:${p.progress}`;
  }

  const truncated = truncateArgs(argsStr);
  return `${name}(${truncated})`;
}

export default { rowType, style, render };

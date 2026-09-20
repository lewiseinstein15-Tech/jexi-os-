/**
 * JEXI OS — Phase 16 Scope C — Row: agent
 * purple (spec) -> #ff6b5e (jcx-coral) token from src/styles/jexi-theme.css — distinct accent
 */

export const rowType = 'agent';

export const style = {
  color: '#ff6b5e', // --jcx-coral from src/styles/jexi-theme.css (spec says purple, real token)
  weight: 600,
  italic: false,
  monospace: false,
};

export function render(event) {
  const p = event?.payload || {};
  const type = event?.type || 'agent';
  if (type === 'agent.spawned') {
    return `agent spawned: ${p.role || ''} [${p.agentId || p.agentId || ''}]`;
  }
  if (type === 'agent.completed') {
    return `agent completed: [${p.agentId || ''}] ${p.status || ''}`;
  }
  return `agent: ${p.agentId || p.role || JSON.stringify(p).slice(0,200)}`;
}

export default { rowType, style, render };

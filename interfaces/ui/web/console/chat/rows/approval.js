/**
 * JEXI OS — Phase 16 Scope C — Row: approval
 * amber card — #e5b567 (jcx-gold)
 */

export const rowType = 'approval';

export const style = {
  color: '#e5b567', // --jcx-gold from src/styles/jexi-theme.css
  weight: 600,
  italic: false,
  monospace: false,
};

export function render(event) {
  const p = event?.payload || {};
  const type = event?.type || 'approval';
  if (type === 'approval.requested') {
    return `approval requested: ${p.reason || p.approvalId || ''}${p.approvalId ? ` [${p.approvalId}]` : ''}`;
  }
  if (type === 'approval.resolved') {
    return `approval ${p.decision || 'resolved'}: ${p.approvalId || ''}`;
  }
  return `approval: ${p.reason || p.decision || p.approvalId || JSON.stringify(p).slice(0,200)}`;
}

export default { rowType, style, render };

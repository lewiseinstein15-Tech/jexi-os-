/**
 * Kanban — WIP by state with limits and blocked items. Upstream: type-kanban.md.
 * Editorial: column headers in mono register; WIP limit as hairline; blocked = down tone.
 */
export default {
  name: 'kanban', label: 'Kanban board',
  description: 'Work-in-progress by state, with WIP limits and blocked items called out.',
  whenToUse: 'Use when flow through states — and where work piles up — is the story.',
  upstream: 'references/type-kanban.md',
  defaults: { width: 960, height: 520 },
  inputSchema: {
    type: 'object', required: ['columns'],
    properties: {
      columns: { type: 'array', items: { type: 'object', required: ['name', 'cards'], properties: { name: { type: 'string' }, wipLimit: { type: 'number' }, cards: { type: 'array', items: { type: 'object', required: ['label'], properties: { label: { type: 'string' }, blocked: { type: 'boolean' } } } } } } },
    },
  },
  render(spec, ctx) {
    const { svg, x, y, w, h } = ctx;
    const cols = spec.columns.slice(0, 5);
    const cw = w / cols.length;
    cols.forEach((col, ci) => {
      const cx = x + ci * cw;
      svg.rect(cx + 6, y, cw - 12, h, { fill: 'panel', rx: 4 });
      svg.text(cx + 18, y + 22, col.name, { size: 10, mono: true, fill: 'ink', weight: 600, spacing: '0.08em', upper: true });
      const over = col.wipLimit != null && col.cards.length > col.wipLimit;
      svg.text(cx + cw - 18, y + 22, col.wipLimit != null ? String(col.cards.length) + '/' + col.wipLimit : String(col.cards.length), { size: 9, mono: true, fill: over ? 'down' : 'soft', anchor: 'end' });
      svg.line(cx + 12, y + 32, cx + cw - 12, y + 32, { stroke: 'line', sw: 0.8 });
      col.cards.slice(0, 5).forEach((card, i) => {
        const cy = y + 48 + i * 58;
        svg.rect(cx + 16, cy, cw - 32, 48, { fill: card.blocked ? 'downTint' : 'paper', stroke: card.blocked ? 'down' : 'rule', sw: card.blocked ? 1.2 : 1, rx: 4 });
        svg.text(cx + 28, cy + 21, String(card.label).slice(0, 26), { size: 10.5, fill: 'ink', weight: 500 });
        if (card.blocked) svg.text(cx + 28, cy + 37, 'blocked', { size: 8, mono: true, fill: 'down', spacing: '0.08em', upper: true });
      });
    });
  },
};

/**
 * Wardley map — value chain against evolution. Upstream: type-wardley.md.
 * Editorial: four evolution bands as quiet panels; the accent dot marks what moves.
 */
export default {
  name: 'wardley', label: 'Wardley map',
  description: 'Components placed on a value-chain (y) by evolution (x) axis, linked by dependency lines.',
  whenToUse: 'Use when deciding what to build vs buy — position and movement matter.',
  upstream: 'references/type-wardley.md',
  defaults: { width: 960, height: 560 },
  inputSchema: {
    type: 'object', required: ['components'],
    properties: {
      components: { type: 'array', items: { type: 'object', required: ['label', 'evolution', 'visibility'], properties: { label: { type: 'string' }, evolution: { type: 'number' }, visibility: { type: 'number' }, moving: { type: 'boolean' } } } },
      links: { type: 'array', items: { type: 'object', required: ['from', 'to'], properties: { from: { type: 'number' }, to: { type: 'number' } } } },
    },
  },
  render(spec, ctx) {
    const { svg, x, y, w, h } = ctx;
    const stages = [['genesis', 0], ['custom', 0.25], ['product', 0.5], ['commodity', 0.75]];
    for (const [name, at] of stages) {
      svg.rect(x + w * at, y, w * 0.25, h, { fill: 'panel', opacity: 0.35 });
      svg.text(x + w * (at + 0.125), y + h - 12, name, { size: 8.5, mono: true, fill: 'soft', anchor: 'middle', spacing: '0.1em', upper: true });
    }
    svg.axisY(x, y, h, { ticks: [{ at: 1, label: 'visible' }, { at: 0, label: 'invisible' }] });
    const pos = new Map();
    spec.components.slice(0, 10).forEach((c, i) => {
      const px = x + 40 + (w - 80) * Math.min(1, Math.max(0, c.evolution));
      const py = y + 24 + (h - 60) * (1 - Math.min(1, Math.max(0, c.visibility)));
      pos.set(i, { px, py });
      svg.circle(px, py, 4.5, { fill: c.moving ? 'accent' : 'paper', stroke: c.moving ? 'accent' : 'ink', sw: 1.2 });
      svg.text(px + 9, py + 4, c.label, { size: 10, fill: 'ink', weight: 500 });
      if (c.moving) svg.arrow(px + 2, py + 10, px + 2, py + 26, { stroke: 'accent', sw: 1.2 });
    });
    for (const l of spec.links || []) {
      const a = pos.get(l.from), c = pos.get(l.to);
      if (a && c) svg.line(a.px, a.py, c.px, c.py, { stroke: 'muted', sw: 0.8 });
    }
  },
};

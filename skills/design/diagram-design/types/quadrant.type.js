/**
 * Quadrant — two-axis positioning. Upstream: type-quadrant.md.
 * Editorial: one hairline cross; the accent dot is the "act now" item.
 */
export default {
  name: 'quadrant', label: 'Quadrant',
  description: 'Items positioned on two axes with the four quadrants named.',
  whenToUse: 'Use when prioritization on two dimensions tells the story.',
  upstream: 'references/type-quadrant.md',
  defaults: { width: 840, height: 620 },
  inputSchema: {
    type: 'object', required: ['items'],
    properties: {
      axes: { type: 'object', properties: { x: { type: 'string' }, y: { type: 'string' } } },
      quadrantLabels: { type: 'array', items: { type: 'string' } },
      items: { type: 'array', items: { type: 'object', required: ['label', 'x', 'y'], properties: { label: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, focal: { type: 'boolean' } } } },
    },
  },
  render(spec, ctx) {
    const { svg, x, y, w, h } = ctx;
    const cx = x + w / 2, cy = y + h / 2;
    svg.rect(x, y, w, h, { fill: 'panel', rx: 4 });
    svg.line(x, cy, x + w, cy, { stroke: 'rule', sw: 0.8 });
    svg.line(cx, y, cx, y + h, { stroke: 'rule', sw: 0.8 });
    const ql = spec.quadrantLabels || [];
    [[x + 12, y + 18], [cx + 12, y + 18], [x + 12, y + h - 10], [cx + 12, y + h - 10]].forEach(([tx, ty], i) => {
      if (ql[i]) svg.text(tx, ty, ql[i], { size: 8, mono: true, fill: 'soft', spacing: '0.1em', upper: true });
    });
    if (spec.axes) {
      svg.text(x + w, y - 8, spec.axes.x || '', { size: 8.5, mono: true, fill: 'soft', anchor: 'end' });
      svg.text(x - 6, y + 4, spec.axes.y || '', { size: 8.5, mono: true, fill: 'soft' });
    }
    for (const it of spec.items.slice(0, 9)) {
      const px = x + w * Math.min(1, Math.max(0, it.x));
      const py = y + h * (1 - Math.min(1, Math.max(0, it.y)));
      svg.circle(px, py, it.focal ? 6 : 4.5, { fill: it.focal ? 'accent' : 'paper', stroke: it.focal ? 'accent' : 'ink', sw: 1.2 });
      svg.text(px + 10, py + 4, it.label, { size: 10.5, fill: 'ink', weight: it.focal ? 600 : 500 });
    }
  },
};

/**
 * Polar — one quantitative series across cyclic categories. Upstream: type-polar.md.
 * Editorial: radial lollipop — hairline spokes, dots, magnitude labels in mono.
 */
export default {
  name: 'polar', label: 'Polar chart',
  description: 'One series across cyclic categories: angle = category, radius = magnitude.',
  whenToUse: 'Use when the quantity is naturally cyclic (hours, months, compass points).',
  upstream: 'references/type-polar.md',
  defaults: { width: 760, height: 640 },
  inputSchema: {
    type: 'object', required: ['categories', 'values'],
    properties: {
      categories: { type: 'array', items: { type: 'string' } },
      values: { type: 'array', items: { type: 'number' } },
    },
  },
  render(spec, ctx) {
    const { svg, x, y, w, h } = ctx;
    const n = Math.min(12, spec.categories.length);
    const cx = x + w / 2, cy = y + h / 2, R = Math.min(w, h) / 2 - 56;
    const max = Math.max(...spec.values.slice(0, n));
    svg.circle(cx, cy, R, { stroke: 'line', sw: 0.8 });
    for (let i = 0; i < n; i++) {
      const a = (Math.PI * 2 * i) / n - Math.PI / 2;
      const sx = cx + R * Math.cos(a), sy = cy + R * Math.sin(a);
      svg.line(cx, cy, sx, sy, { stroke: 'line', sw: 0.8 });
      svg.text(cx + (R + 14) * Math.cos(a), cy + (R + 14) * Math.sin(a) + 3, spec.categories[i], { size: 8.5, mono: true, fill: 'soft', anchor: 'middle' });
      const r = R * (spec.values[i] / max);
      const px = cx + r * Math.cos(a), py = cy + r * Math.sin(a);
      svg.line(cx, cy, px, py, { stroke: 'accent', sw: 1.2 });
      svg.circle(px, py, 4.5, { fill: 'accent' });
      svg.text(px + 8 * Math.cos(a), py + 8 * Math.sin(a) + 3, String(spec.values[i]), { size: 8.5, mono: true, fill: 'ink', anchor: 'middle' });
    }
    svg.circle(cx, cy, 3, { fill: 'ink' });
  },
};

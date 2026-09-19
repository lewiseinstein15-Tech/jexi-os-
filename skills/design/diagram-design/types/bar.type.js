/**
 * Bar chart — quantitative comparison across categories. Upstream: type-bar.md.
 * Editorial: horizontal bars from a quiet baseline; the max bar carries accent.
 */
export default {
  name: 'bar', label: 'Bar chart',
  description: 'Categories compared by a single quantitative measure, bars from a shared baseline.',
  whenToUse: 'Use when a handful of categories need honest numeric comparison.',
  upstream: 'references/type-bar.md',
  defaults: { width: 840, height: 560 },
  inputSchema: {
    type: 'object', required: ['items'],
    properties: { items: { type: 'array', items: { type: 'object', required: ['label', 'value'], properties: { label: { type: 'string' }, value: { type: 'number' } } } } },
  },
  render(spec, ctx) {
    const { svg, x, y, w, h } = ctx;
    const items = spec.items.slice(0, 8);
    const max = Math.max(...items.map((i) => i.value));
    const labelW = 150, rh = (h - 24) / items.length;
    const bw = w - labelW - 70;
    svg.line(x + labelW, y, x + labelW, y + h - 24, { stroke: 'line', sw: 1 });
    items.forEach((it, i) => {
      const by = y + i * rh + rh / 2;
      const len = Math.max(4, (bw * it.value) / max);
      svg.rect(x + labelW, by - rh * 0.28, len, rh * 0.56, { fill: it.value === max ? 'accent' : 'panel3', rx: 2 });
      svg.text(x + labelW - 12, by + 4, it.label, { size: 10.5, fill: 'ink', anchor: 'end', weight: 500 });
      svg.text(x + labelW + len + 10, by + 4, String(it.value), { size: 9.5, mono: true, fill: 'muted' });
    });
  },
};

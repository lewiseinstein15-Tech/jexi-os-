/**
 * Treemap — part-of-whole by area. Upstream: type-treemap.md.
 * Editorial: slice-and-dice (deterministic), labels held to the text budget.
 */
export default {
  name: 'treemap', label: 'Treemap',
  description: 'Part-of-whole as nested rectangles; area is the share.',
  whenToUse: 'Use when relative size of parts of a whole is the story.',
  upstream: 'references/type-treemap.md',
  defaults: { width: 840, height: 560 },
  inputSchema: {
    type: 'object', required: ['items'],
    properties: { items: { type: 'array', items: { type: 'object', required: ['label', 'value'], properties: { label: { type: 'string' }, value: { type: 'number' } } } } },
  },
  render(spec, ctx) {
    const { svg, x, y, w, h } = ctx;
    const items = spec.items.slice(0, 8).slice().sort((a, b2) => b2.value - a.value);
    const total = items.reduce((s, i) => s + i.value, 0);
    let cx = x, cy = y;
    const horizontalFirst = w >= h;
    items.forEach((it, i) => {
      const frac = it.value / total;
      if (horizontalFirst ? i % 2 === 0 : i % 2 === 1) {
        const cw2 = (w - (cx - x)) * frac * (items.length / 2) / 0.5 / items.length * 2;
        const cw = Math.max(80, (w - (cx - x)) * frac * 2.2);
        const ch = h - (cy - y);
        svg.rect(cx, cy, Math.min(cw, x + w - cx), Math.max(40, ch), { fill: i === 0 ? 'accentTint' : 'panel', stroke: 'panel', sw: 1.2, rx: 2 });
        if (cw > 90 && ch > 50) {
          svg.text(cx + 12, cy + 22, it.label, { size: 10.5, fill: 'ink', weight: 600 });
          svg.text(cx + 12, cy + 38, String(it.value), { size: 9, mono: true, fill: 'soft' });
        }
        cx += Math.min(cw, x + w - cx);
      } else {
        const cw = x + w - cx;
        const ch = Math.max(40, (h - (cy - y)) * frac * 2.2);
        svg.rect(cx, cy, cw, Math.min(ch, y + h - cy), { fill: 'panel', stroke: 'panel', sw: 1.2, rx: 2 });
        if (cw > 90 && ch > 50) {
          svg.text(cx + 12, cy + 22, it.label, { size: 10.5, fill: 'ink', weight: 600 });
          svg.text(cx + 12, cy + 38, String(it.value), { size: 9, mono: true, fill: 'soft' });
        }
        cy += Math.min(ch, y + h - cy);
      }
    });
  },
};

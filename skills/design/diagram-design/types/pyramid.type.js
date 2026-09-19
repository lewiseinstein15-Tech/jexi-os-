/**
 * Pyramid / funnel — ranked hierarchy or conversion. Upstream: type-pyramid.md.
 * Editorial: centered trapezoids; the widest tier quietest, apex carries accent.
 */
export default {
  name: 'pyramid', label: 'Pyramid / funnel',
  description: 'Ranked tiers as centered trapezoids, widest at the base (or funnel drop-offs).',
  whenToUse: 'Use when a ranked hierarchy or a conversion sequence is the whole idea.',
  upstream: 'references/type-pyramid.md',
  defaults: { width: 760, height: 560 },
  inputSchema: {
    type: 'object', required: ['tiers'],
    properties: { tiers: { type: 'array', items: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, value: { type: 'string' } } } } },
  },
  render(spec, ctx) {
    const { svg, x, y, w, h } = ctx;
    const tiers = spec.tiers.slice(0, 5);
    const n = tiers.length;
    const th = (h - 10 * (n - 1)) / n;
    tiers.forEach((t, i) => {
      const ty = y + i * (th + 10);
      const wTop = (w * (n - 1 - i)) / n * 0.9 + w * 0.1;
      const wBot = (w * (n - i)) / n * 0.9 + w * 0.1;
      const cx = x + w / 2;
      const focal = i === 0;
      svg.polygon([[cx - wTop / 2, ty], [cx + wTop / 2, ty], [cx + wBot / 2, ty + th], [cx - wBot / 2, ty + th]], { fill: focal ? 'accentTint' : 'panel', stroke: focal ? 'accent' : 'rule', sw: 1 });
      svg.text(cx, ty + th / 2 + 1, t.name, { size: 11.5, fill: 'ink', anchor: 'middle', weight: 600 });
      if (t.value) svg.text(cx, ty + th / 2 + 17, t.value, { size: 9, mono: true, fill: focal ? 'accent' : 'soft', anchor: 'middle' });
    });
  },
};

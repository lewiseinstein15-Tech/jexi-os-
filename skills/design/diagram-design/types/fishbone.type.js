/**
 * Fishbone — causes of one effect, grouped by category. Upstream: type-fishbone.md.
 * Editorial: one spine, angled ribs, the effect boxed at the head (single accent).
 */
export default {
  name: 'fishbone', label: 'Fishbone',
  description: 'Root-cause skeleton: category ribs off a central spine leading to one effect.',
  whenToUse: 'Use when one observed effect needs its causes organized by category.',
  upstream: 'references/type-fishbone.md',
  defaults: { width: 960, height: 520 },
  inputSchema: {
    type: 'object', required: ['effect', 'categories'],
    properties: {
      effect: { type: 'string' },
      categories: { type: 'array', items: { type: 'object', required: ['name', 'causes'], properties: { name: { type: 'string' }, causes: { type: 'array', items: { type: 'string' } } } } },
    },
  },
  render(spec, ctx) {
    const { svg, x, y, w, h } = ctx;
    const midY = y + h / 2;
    const spineX0 = x + 20, spineX1 = x + w - 190;
    svg.line(spineX0, midY, spineX1, midY, { stroke: 'ink', sw: 1.2 });
    svg.box(spineX1 + 95, midY, spec.effect, { fill: 'accentTint', stroke: 'accent', color: 'ink', weight: 600, minW: 168, minH: 44 });
    const cats = spec.categories.slice(0, 6);
    cats.forEach((cat, i) => {
      const up = i % 2 === 0;
      const cx = spineX0 + (spineX1 - spineX0 - 60) * (((i >> 1) + 0.75) / (Math.ceil(cats.length / 2) + 0.1));
      const ry = midY + (up ? -1 : 1) * (h * 0.36);
      svg.line(cx, midY, cx + 46, ry, { stroke: 'rule', sw: 1 });
      svg.text(cx + 50, ry + (up ? -6 : 14), cat.name, { size: 10.5, mono: true, fill: 'ink', weight: 600, spacing: '0.04em' });
      cat.causes.slice(0, 3).forEach((cause, ci) => {
        const t = 0.32 + ci * 0.22;
        const px = cx + 46 * t, py = midY + (ry - midY) * t;
        svg.line(px, py, px + 34, py + (up ? -10 : 10), { stroke: 'line', sw: 0.8 });
        svg.text(px + 38, py + (up ? -12 : 16), cause, { size: 9.5, fill: 'muted' });
      });
    });
  },
};

/**
 * Medallion — multi-tier data quality. Upstream: type-medallion.md.
 * Editorial: bronze/silver/gold rendered in brand tones (panel, sand, gold);
 * quality gates as hairline chips between tiers.
 */
export default {
  name: 'medallion', label: 'Medallion',
  description: 'Bronze, silver, gold data tiers with quality gates and access policies.',
  whenToUse: 'Use when data quality tiers and what each tier promises is the subject.',
  upstream: 'references/type-medallion.md',
  defaults: { width: 960, height: 480 },
  inputSchema: {
    type: 'object', required: ['tiers'],
    properties: { tiers: { type: 'array', items: { type: 'object', required: ['name', 'promise'], properties: { name: { type: 'string' }, promise: { type: 'string' }, consumers: { type: 'string' } } } } },
  },
  render(spec, ctx) {
    const { svg, x, y, w, h } = ctx;
    const tiers = spec.tiers.slice(0, 3);
    const tones = [['panel3', 'rule'], ['sand', 'rule'], ['gold', 'gold']];
    const cw = (w - 2 * 70) / tiers.length;
    tiers.forEach((t, i) => {
      const cx = x + 35 + cw * (i + 0.5) + i * 70;
      const [fill, stroke] = tones[i] || tones[0];
      svg.rect(cx - cw / 2, y + 40, cw, h - 110, { fill, stroke, rx: 6 });
      svg.text(cx, y + 76, t.name, { size: 13, fill: 'ink', anchor: 'middle', weight: 600 });
      svg.text(cx, y + 100, t.promise, { size: 9.5, mono: true, fill: 'muted', anchor: 'middle' });
      if (t.consumers) svg.chip(cx, y + h - 96, t.consumers, { color: 'ink' });
      if (i < tiers.length - 1) {
        svg.arrow(cx + cw / 2 + 8, y + 40 + (h - 110) / 2, cx + cw / 2 + 62, y + 40 + (h - 110) / 2, { stroke: 'muted', label: 'quality gate', labelMono: true });
      }
    });
  },
};

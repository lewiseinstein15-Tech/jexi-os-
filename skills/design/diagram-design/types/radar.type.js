/**
 * Radar — entities scored across 3–5 criteria. Upstream: type-radar.md.
 * Editorial: the focal series in accent; others quiet; criteria in mono register.
 */
export default {
  name: 'radar', label: 'Radar / spider',
  description: 'One or more series scored across 3-5 criteria on a radial grid.',
  whenToUse: 'Use when comparing entities across a handful of quantitative criteria.',
  upstream: 'references/type-radar.md',
  defaults: { width: 760, height: 640 },
  inputSchema: {
    type: 'object', required: ['criteria', 'series'],
    properties: {
      criteria: { type: 'array', items: { type: 'string' } },
      series: { type: 'array', items: { type: 'object', required: ['name', 'values'], properties: { name: { type: 'string' }, values: { type: 'array', items: { type: 'number' } }, focal: { type: 'boolean' } } } },
    },
  },
  render(spec, ctx) {
    const { svg, x, y, w, h } = ctx;
    const crit = spec.criteria.slice(0, 5);
    const n = crit.length;
    const cx = x + w / 2, cy = y + h / 2, R = Math.min(w, h) / 2 - 60;
    for (const ring of [0.25, 0.5, 0.75, 1]) {
      svg.polygon(Array.from({ length: n }, (_, i) => {
        const a = (Math.PI * 2 * i) / n - Math.PI / 2;
        return [cx + R * ring * Math.cos(a), cy + R * ring * Math.sin(a)];
      }), { stroke: 'line', sw: 0.8 });
    }
    crit.forEach((c, i) => {
      const a = (Math.PI * 2 * i) / n - Math.PI / 2;
      svg.line(cx, cy, cx + R * Math.cos(a), cy + R * Math.sin(a), { stroke: 'line', sw: 0.8 });
      svg.text(cx + (R + 16) * Math.cos(a), cy + (R + 16) * Math.sin(a) + 3, c, { size: 9, mono: true, fill: 'soft', anchor: 'middle', upper: true });
    });
    for (const s of spec.series.slice(0, 3)) {
      const pts = s.values.slice(0, n).map((v, i) => {
        const a = (Math.PI * 2 * i) / n - Math.PI / 2;
        return [cx + R * Math.min(1, Math.max(0, v)) * Math.cos(a), cy + R * Math.min(1, Math.max(0, v)) * Math.sin(a)];
      });
      svg.polygon(pts, { fill: s.focal ? 'accentTint' : 'panel', stroke: s.focal ? 'accent' : 'muted', sw: s.focal ? 1.2 : 1 });
      if (s.focal) for (const [px, py] of pts) svg.circle(px, py, 3, { fill: 'accent' });
      svg.text(cx, y + 14, s.name, { size: 9, mono: true, fill: s.focal ? 'accent' : 'muted', anchor: 'middle' });
    }
  },
};

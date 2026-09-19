/**
 * Scatter — distribution and correlation. Upstream: type-scatter.md.
 * Editorial: small honest dots, sparse ticks, no trendline unless asked.
 */
export default {
  name: 'scatter', label: 'Scatter plot',
  description: 'Two quantitative variables, one dot per item.',
  whenToUse: 'Use when spread and correlation between two measures is the story.',
  upstream: 'references/type-scatter.md',
  defaults: { width: 840, height: 600 },
  inputSchema: {
    type: 'object', required: ['points'],
    properties: {
      points: { type: 'array', items: { type: 'object', required: ['x', 'y'], properties: { x: { type: 'number' }, y: { type: 'number' }, label: { type: 'string' } } } },
      xLabel: { type: 'string' }, yLabel: { type: 'string' },
    },
  },
  render(spec, ctx) {
    const { svg, x, y, w, h } = ctx;
    const pts = spec.points.slice(0, 60);
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const xmin = Math.min(...xs), xmax = Math.max(...xs), ymin = Math.min(...ys), ymax = Math.max(...ys);
    const plotW = w - 90, plotH = h - 70;
    svg.axisY(x + 50, y, plotH, { ticks: [{ at: 1, label: String(Math.round(ymax)) }, { at: 0, label: String(Math.round(ymin)) }] });
    svg.axisX(x + 50, y + plotH, plotW, { ticks: [{ at: 0, label: String(Math.round(xmin)) }, { at: 1, label: String(Math.round(xmax)) }] });
    if (spec.xLabel) svg.text(x + 50 + plotW / 2, y + plotH + 30, spec.xLabel, { size: 9, mono: true, fill: 'soft', anchor: 'middle' });
    if (spec.yLabel) svg.text(x + 50, y - 12, spec.yLabel, { size: 9, mono: true, fill: 'soft' });
    for (const p of pts) {
      const px = x + 50 + plotW * ((p.x - xmin) / Math.max(1e-9, xmax - xmin));
      const py = y + plotH - plotH * ((p.y - ymin) / Math.max(1e-9, ymax - ymin));
      svg.circle(px, py, 4, { fill: 'accentTint', stroke: 'accent', sw: 1 });
      if (p.label) svg.text(px + 8, py + 4, p.label, { size: 9, fill: 'muted' });
    }
  },
};

/**
 * Line chart — continuous trends / slopegraph. Upstream: type-line.md.
 * Editorial: hairline grid off; series end-labeled instead of a legend box.
 */
export default {
  name: 'line', label: 'Line chart',
  description: 'One or more series over a shared x scale, end-labeled rather than boxed-legend.',
  whenToUse: 'Use when continuous change over an ordered axis is the story.',
  upstream: 'references/type-line.md',
  defaults: { width: 960, height: 520 },
  inputSchema: {
    type: 'object', required: ['series'],
    properties: {
      xLabels: { type: 'array', items: { type: 'string' } },
      series: { type: 'array', items: { type: 'object', required: ['name', 'values'], properties: { name: { type: 'string' }, values: { type: 'array', items: { type: 'number' } }, focal: { type: 'boolean' } } } },
    },
  },
  render(spec, ctx) {
    const { svg, x, y, w, h } = ctx;
    const all = spec.series.flatMap((s) => s.values);
    const max = Math.max(...all), min = Math.min(0, ...all);
    const n = Math.max(...spec.series.map((s) => s.values.length));
    const plotW = w - 130, plotH = h - 30;
    svg.axisY(x + 40, y, plotH, { ticks: [0, 0.5, 1].map((at) => ({ at, label: String(Math.round(max - (max - min) * at)) })) });
    const xl = spec.xLabels || [];
    if (xl.length) svg.axisX(x + 40, y + plotH, plotW, { ticks: xl.slice(0, n).map((label, i) => ({ at: n === 1 ? 0.5 : i / (n - 1), label })) });
    for (const s of spec.series.slice(0, 4)) {
      const pts = s.values.map((v, i) => [x + 40 + plotW * (n === 1 ? 0.5 : i / (n - 1)), y + plotH - plotH * ((v - min) / Math.max(1e-9, max - min))]);
      svg.polyline(pts, { stroke: s.focal ? 'accent' : 'muted', sw: s.focal ? 1.2 : 1 });
      const last = pts[pts.length - 1];
      svg.circle(last[0], last[1], 3.5, { fill: s.focal ? 'accent' : 'paper', stroke: s.focal ? 'accent' : 'muted', sw: 1.2 });
      svg.text(last[0] + 10, last[1] + 4, s.name, { size: 10, fill: s.focal ? 'accent' : 'muted', weight: s.focal ? 600 : 500 });
    }
  },
};

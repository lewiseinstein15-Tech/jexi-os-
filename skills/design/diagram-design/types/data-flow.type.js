/**
 * Data flow — fan-in / capacity / bottleneck. Upstream: type-data-flow.md.
 * Editorial: the constrained stage is the single accent; queue depth visible as a chip.
 */
export default {
  name: 'data-flow', label: 'Data flow',
  description: 'Sources fan into a processing bottleneck and out to sinks; queue depth is visible.',
  whenToUse: 'Use when fan-in, queue depth, or finite capacity is the story.',
  upstream: 'references/type-data-flow.md',
  defaults: { width: 960, height: 520 },
  inputSchema: {
    type: 'object', required: ['sources', 'pipeline', 'sinks'],
    properties: {
      sources: { type: 'array', items: { type: 'string' } },
      pipeline: { type: 'array', items: { type: 'string' } },
      sinks: { type: 'array', items: { type: 'string' } },
      capacity: { type: 'string' },
    },
  },
  render(spec, ctx) {
    const { svg, x, y, w, h } = ctx;
    const col = (items, cx, focalIdx) => {
      const ys = Array.from({ length: items.length }, (_, i) => y + (h * (i + 0.5)) / items.length);
      items.forEach((label, i) => svg.box(cx, ys[i], label, { fill: i === focalIdx ? 'accentTint' : 'panel', stroke: i === focalIdx ? 'accent' : 'rule', minW: 150, minH: 38 }));
      return ys;
    };
    const sYs = col(spec.sources.slice(0, 4), x + 95, -1);
    const midX = x + w / 2;
    const pYs = col(spec.pipeline.slice(0, 3), midX, 0);
    const kYs = col(spec.sinks.slice(0, 3), x + w - 95, -1);
    for (const sy of sYs) svg.arrow(x + 172, sy, midX - 92, pYs[0], { stroke: 'muted', elbow: true });
    for (let i = 0; i < pYs.length - 1; i++) svg.arrow(midX, pYs[i] + 20, midX, pYs[i + 1] - 20, { stroke: 'muted' });
    svg.chip(midX, (pYs[0] + pYs[pYs.length - 1]) / 2, spec.capacity || 'bounded queue', { color: 'accent', stroke: 'accent' });
    for (const ky of kYs) svg.arrow(midX + 92, pYs[pYs.length - 1], x + w - 172, ky, { stroke: 'muted', elbow: true });
  },
};

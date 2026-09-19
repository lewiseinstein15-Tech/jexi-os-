/**
 * DP integration — sources, core, consumers. Upstream: type-dp-integration.md.
 * Editorial: three columns; every edge crosses the core column; core is the accent frame.
 */
export default {
  name: 'dp-integration', label: 'Data platform integration',
  description: 'Integration topology: sources into the platform core, out to consumers.',
  whenToUse: 'Use when what feeds the platform — and who consumes it — is the map.',
  upstream: 'references/type-dp-integration.md',
  defaults: { width: 960, height: 540 },
  inputSchema: {
    type: 'object', required: ['sources', 'core', 'consumers'],
    properties: {
      sources: { type: 'array', items: { type: 'string' } },
      core: { type: 'array', items: { type: 'string' } },
      consumers: { type: 'array', items: { type: 'string' } },
    },
  },
  render(spec, ctx) {
    const { svg, x, y, w, h } = ctx;
    const col = (items, cx, opts = {}) => {
      const ys = Array.from({ length: items.length }, (_, i) => y + (h * (i + 0.5)) / items.length);
      if (opts.frame) svg.rect(cx - 118, y + 6, 236, h - 12, { fill: opts.frame, stroke: 'rule', sw: 0.8, rx: 6 });
      items.forEach((label, i) => svg.box(cx, ys[i], label, { fill: opts.fill || 'panel', stroke: opts.accent ? 'accent' : 'rule', minW: 170, minH: 40 }));
      return ys;
    };
    const sYs = col(spec.sources.slice(0, 4), x + 110);
    const cYs = col(spec.core.slice(0, 3), x + w / 2, { frame: 'accentTint', accent: true });
    const kYs = col(spec.consumers.slice(0, 4), x + w - 110);
    for (const sy of sYs) svg.arrow(x + 197, sy, x + w / 2 - 118, cYs[0] + (h / 2) * 0.25, { stroke: 'link', elbow: true, sw: 0.9 });
    for (const ky of kYs) svg.arrow(x + w / 2 + 118, cYs[cYs.length - 1], x + w - 197, ky, { stroke: 'link', elbow: true, sw: 0.9 });
  },
};

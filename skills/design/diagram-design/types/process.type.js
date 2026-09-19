/**
 * Process — multi-actor sequential steps with handoffs. Upstream: type-process.md.
 * Editorial: one row per actor; steps chained; handoffs cross actors in link tone.
 */
export default {
  name: 'process', label: 'Process',
  description: 'A sequential process across actors with data handoffs at each step.',
  whenToUse: 'Use when a pipeline has owners and artifacts move between them.',
  upstream: 'references/type-process.md',
  defaults: { width: 960, height: 480 },
  inputSchema: {
    type: 'object', required: ['steps'],
    properties: { steps: { type: 'array', items: { type: 'object', required: ['label', 'actor'], properties: { label: { type: 'string' }, actor: { type: 'string' } } } } },
  },
  render(spec, ctx) {
    const { svg, x, y, w, h } = ctx;
    const steps = spec.steps.slice(0, 6);
    const actors = [...new Set(steps.map((s) => s.actor))];
    const rowOf = new Map(actors.map((a, i) => [a, i]));
    const rowH = h / Math.max(1, actors.length);
    actors.forEach((a, i) => {
      const ry = y + i * rowH + rowH / 2;
      svg.rect(x, ry - rowH / 2 + 4, w, rowH - 8, { fill: i % 2 ? 'panel' : 'paper2', rx: 4 });
      svg.text(x + 12, ry + 4, a, { size: 10, mono: true, fill: 'soft', spacing: '0.08em', upper: true });
    });
    const cw = (w - 60) / steps.length;
    const centers = [];
    steps.forEach((s, i) => {
      const cx = x + 40 + cw * (i + 0.5);
      const cy = y + rowOf.get(s.actor) * rowH + rowH / 2;
      centers.push({ cx, cy });
      svg.box(cx, cy, s.label, { fill: 'paper', stroke: 'rule', minW: Math.min(140, cw - 20), minH: 36, size: 10 });
    });
    for (let i = 0; i < centers.length - 1; i++) {
      const a = centers[i], c = centers[i + 1];
      const cross = a.cy !== c.cy;
      svg.arrow(a.cx + cw * 0.32, a.cy, c.cx - cw * 0.32, c.cy, { stroke: cross ? 'link' : 'muted', elbow: cross, sw: cross ? 1.2 : 1 });
    }
  },
};

/**
 * High-level — end-to-end data stack on a container. Upstream: type-high-level.md.
 * Editorial: one quiet container, stages left to right, counts in mono.
 */
export default {
  name: 'high-level', label: 'High-level stack',
  description: 'An end-to-end platform on one container: ingest, store, process, serve.',
  whenToUse: 'Use when the whole platform fits in one view and detail would bury it.',
  upstream: 'references/type-high-level.md',
  defaults: { width: 960, height: 460 },
  inputSchema: {
    type: 'object', required: ['stages'],
    properties: {
      container: { type: 'string' },
      stages: { type: 'array', items: { type: 'object', required: ['name', 'items'], properties: { name: { type: 'string' }, items: { type: 'array', items: { type: 'string' } } } } },
    },
  },
  render(spec, ctx) {
    const { svg, x, y, w, h } = ctx;
    svg.rect(x, y, w, h, { fill: 'paper2', stroke: 'rule', sw: 0.8, rx: 6 });
    svg.chip(x + 16, y + 18, spec.container || 'platform', { color: 'ink' });
    const stages = spec.stages.slice(0, 4);
    const cw = (w - 48) / stages.length;
    stages.forEach((s, i) => {
      const cx = x + 24 + cw * (i + 0.5);
      const cy = y + 70;
      svg.text(cx, y + 52, s.name, { size: 9, mono: true, fill: 'soft', anchor: 'middle', spacing: '0.1em', upper: true });
      s.items.slice(0, 3).forEach((it, ii) => {
        svg.box(cx, cy + ii * 54, it, { fill: i === 0 ? 'panel' : 'paper', stroke: 'rule', minW: Math.min(170, cw - 20), minH: 40, size: 10.5 });
      });
      if (i < stages.length - 1) svg.arrow(cx + cw / 2 - 6, cy + 40, cx + cw / 2 + 6, cy + 40, { stroke: 'muted' });
    });
  },
};

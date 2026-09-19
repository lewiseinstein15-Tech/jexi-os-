/**
 * Loop / flywheel — a reinforcing cycle. Upstream: type-loop.md.
 * Editorial: circular arrows around a hub; the hub accumulates state (single accent).
 */
export default {
  name: 'loop', label: 'Loop / flywheel',
  description: 'Steps arranged in a reinforcing cycle around a hub that accumulates the gains.',
  whenToUse: 'Use when each step feeds the next and the last feeds the first.',
  upstream: 'references/type-loop.md',
  defaults: { width: 720, height: 660 },
  inputSchema: {
    type: 'object', required: ['steps'],
    properties: {
      hub: { type: 'string' },
      steps: { type: 'array', items: { type: 'string' } },
    },
  },
  render(spec, ctx) {
    const { svg, x, y, w, h } = ctx;
    const steps = spec.steps.slice(0, 6);
    const n = steps.length;
    const cx = x + w / 2, cy = y + h / 2, R = Math.min(w, h) / 2 - 80;
    for (let i = 0; i < n; i++) {
      const a0 = (Math.PI * 2 * i) / n - Math.PI / 2;
      const a1 = (Math.PI * 2 * (i + 1)) / n - Math.PI / 2;
      const arcR = R + 26;
      const x0 = cx + arcR * Math.cos(a0 + 0.16), y0 = cy + arcR * Math.sin(a0 + 0.16);
      const x1 = cx + arcR * Math.cos(a1 - 0.16), y1 = cy + arcR * Math.sin(a1 - 0.16);
      svg.path(`M ${Math.round(x0)} ${Math.round(y0)} A ${Math.round(arcR)} ${Math.round(arcR)} 0 0 1 ${Math.round(x1)} ${Math.round(y1)}`, { stroke: 'muted', sw: 1 });
      svg.arrowHead(x1, y1, ((a1 - 0.02) * 180) / Math.PI + 90, { stroke: 'muted', size: 5 });
      const px = cx + R * Math.cos((a0 + a1) / 2), py = cy + R * Math.sin((a0 + a1) / 2);
      svg.box(px, py, steps[i], { fill: 'panel', stroke: 'rule', minW: 118, minH: 38, size: 10.5 });
    }
    svg.circle(cx, cy, 44, { fill: 'accentTint', stroke: 'accent', sw: 1.2 });
    svg.text(cx, cy - 2, spec.hub || 'flywheel', { size: 10, mono: true, fill: 'accent', anchor: 'middle', weight: 600, upper: true });
    svg.text(cx, cy + 14, 'compounds', { size: 8, mono: true, fill: 'muted', anchor: 'middle' });
  },
};

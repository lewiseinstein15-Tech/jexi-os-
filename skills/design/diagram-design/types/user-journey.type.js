/**
 * User journey — stages, emotion, touchpoints. Upstream: type-journey.md.
 * Editorial: the emotion line is the figure; stages are quiet bands beneath.
 */
export default {
  name: 'user-journey', label: 'User journey',
  description: 'Stages of an experience with an emotion line and the touchpoints that shape it.',
  whenToUse: 'Use when how a person moves through stages — and how it feels — is the story.',
  upstream: 'references/type-journey.md',
  defaults: { width: 960, height: 480 },
  inputSchema: {
    type: 'object', required: ['stages'],
    properties: {
      stages: { type: 'array', items: { type: 'object', required: ['name', 'emotion'], properties: { name: { type: 'string' }, emotion: { type: 'number' }, touchpoint: { type: 'string' } } } },
    },
  },
  render(spec, ctx) {
    const { svg, x, y, w, h } = ctx;
    const stages = spec.stages.slice(0, 7);
    const bandY = y + h * 0.72;
    const cw = w / stages.length;
    stages.forEach((s, i) => {
      const bx = x + i * cw;
      svg.rect(bx + 3, bandY, cw - 6, h - (bandY - y) - 6, { fill: i % 2 ? 'panel' : 'paper2', rx: 4 });
      svg.text(bx + cw / 2, bandY + 24, s.name, { size: 10.5, fill: 'ink', anchor: 'middle', weight: 600 });
      if (s.touchpoint) svg.text(bx + cw / 2, bandY + 42, String(s.touchpoint).slice(0, 22), { size: 8.5, mono: true, fill: 'soft', anchor: 'middle' });
    });
    const pts = stages.map((s, i) => [x + cw * (i + 0.5), y + 30 + (h * 0.5) * (1 - Math.min(1, Math.max(0, s.emotion)))]);
    svg.polyline(pts, { stroke: 'accent', sw: 1.2 });
    pts.forEach(([px, py], i) => {
      svg.circle(px, py, 4, { fill: 'paper', stroke: 'accent', sw: 1.2 });
      const e = spec.stages[i].emotion;
      svg.text(px, py - 10, e >= 0.66 ? 'delight' : e >= 0.33 ? 'ok' : 'pain', { size: 8, mono: true, fill: e >= 0.33 ? 'muted' : 'down', anchor: 'middle', upper: true });
    });
  },
};

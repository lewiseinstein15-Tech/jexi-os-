/**
 * Timeline — events positioned in time. Upstream: type-timeline.md.
 * Editorial: one hairline spine, alternating labels, mono date register.
 */
export default {
  name: 'timeline', label: 'Timeline',
  description: 'Events positioned along a single horizontal spine with alternating labels.',
  whenToUse: 'Use when a sequence of dated events needs relative position, not a chart.',
  upstream: 'references/type-timeline.md',
  defaults: { width: 960, height: 420 },
  inputSchema: {
    type: 'object', required: ['events'],
    properties: { events: { type: 'array', items: { type: 'object', required: ['date', 'label'], properties: { date: { type: 'string' }, label: { type: 'string' }, milestone: { type: 'boolean' } } } } },
  },
  render(spec, ctx) {
    const { svg, x, y, w, h } = ctx;
    const events = spec.events.slice(0, 7);
    const midY = y + h / 2;
    svg.line(x + 10, midY, x + w - 10, midY, { stroke: 'line', sw: 1 });
    svg.arrowHead(x + w - 10, midY, 0, { stroke: 'line', size: 5 });
    events.forEach((e, i) => {
      const cx = x + 10 + (w - 20) * (i + 0.5) / events.length;
      const up = i % 2 === 0;
      const ey = midY + (up ? -46 : 46);
      svg.line(cx, midY, cx, ey, { stroke: 'rule', sw: 0.8 });
      svg.circle(cx, midY, e.milestone ? 6 : 4, { fill: e.milestone ? 'accent' : 'paper', stroke: e.milestone ? 'accent' : 'muted', sw: 1.2 });
      svg.text(cx, ey + (up ? -14 : 12), e.date, { size: 8.5, mono: true, fill: 'soft', anchor: 'middle' });
      svg.text(cx, ey + (up ? -26 : 26), e.label, { size: 11, fill: 'ink', anchor: 'middle', weight: 500 });
    });
  },
};

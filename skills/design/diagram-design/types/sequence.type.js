/**
 * Sequence — time-ordered messages between actors. Upstream: type-sequence.md.
 * Editorial: hairline dashed lifelines, activation bars only where work happens.
 */
export default {
  name: 'sequence', label: 'Sequence diagram',
  description: 'Time-ordered messages between actors with lifelines, activation bars, and return arrows.',
  whenToUse: 'Use when the order of messages between components carries the meaning.',
  upstream: 'references/type-sequence.md',
  defaults: { width: 960, height: 520 },
  inputSchema: {
    type: 'object', required: ['actors', 'messages'],
    properties: {
      actors: { type: 'array', items: { type: 'string' } },
      messages: { type: 'array', items: { type: 'object', required: ['from', 'to', 'label'], properties: { from: { type: 'number' }, to: { type: 'number' }, label: { type: 'string' }, dashed: { type: 'boolean' } } } },
    },
  },
  render(spec, ctx) {
    const { svg, x, y, w, h } = ctx;
    const actors = spec.actors.slice(0, 6);
    const xs = actors.map((_, i) => x + (w * (i + 0.5)) / actors.length);
    const top = y + 6, bot = y + h - 8;
    actors.forEach((a, i) => {
      svg.box(xs[i], top, a, { fill: 'panel2', stroke: 'rule', minW: 104, size: 12, weight: 600 });
      svg.line(xs[i], top + 20, xs[i], bot, { stroke: 'line', sw: 0.8, dash: '2 4' });
    });
    const step = Math.min(42, (bot - top - 40) / Math.max(1, spec.messages.length));
    spec.messages.forEach((m, i) => {
      const my = top + 40 + i * step;
      const x1 = xs[m.from], x2 = xs[m.to];
      svg.line(x1, my, x2, my, { stroke: m.dashed ? 'soft' : 'muted', sw: 1, dash: m.dashed ? '4 3' : null });
      svg.arrowHead(x2, my, x2 > x1 ? 0 : 180, { stroke: 'muted', size: 4 });
      svg.text((x1 + x2) / 2, my - 6, m.label, { size: 9.5, mono: true, fill: 'ink', anchor: 'middle' });
      svg.rect(x1 - 3, my - step / 2 + 6, 6, step - 10, { fill: 'panel3', stroke: 'rule', sw: 0.8, rx: 2 });
    });
  },
};

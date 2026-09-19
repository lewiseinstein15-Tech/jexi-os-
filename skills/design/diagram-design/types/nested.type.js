/**
 * Nested — hierarchy through containment. Upstream: type-nested.md.
 * Editorial: rings of scope as quiet panels; labels top-left in mono register.
 */
export default {
  name: 'nested', label: 'Nested',
  description: 'Hierarchy expressed by containment: outer scopes hold inner scopes.',
  whenToUse: 'Use when everything-is-inside-something is simpler than parent-child arrows.',
  upstream: 'references/type-nested.md',
  defaults: { width: 840, height: 560 },
  inputSchema: {
    type: 'object', required: ['levels'],
    properties: { levels: { type: 'array', items: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, note: { type: 'string' } } } } },
  },
  render(spec, ctx) {
    const { svg, x, y, w, h } = ctx;
    const levels = spec.levels.slice(0, 5);
    levels.forEach((lvl, i) => {
      const inset = i * 42;
      svg.rect(x + inset, y + inset, w - inset * 2, h - inset * 2, { fill: i % 2 ? 'panel' : 'paper2', stroke: 'rule', sw: 0.8, rx: 6 });
      svg.chip(x + inset + 14, y + inset + 14, lvl.name, { color: 'ink', fill: 'paper' });
      if (lvl.note) svg.text(x + inset + 60, y + inset + 18, lvl.note, { size: 9, fill: 'soft' });
    });
  },
};

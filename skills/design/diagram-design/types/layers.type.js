/**
 * Layer stack — stacked abstraction levels. Upstream: type-layers.md.
 * Editorial: full-width bands, the enforced-at register on the right in mono.
 */
export default {
  name: 'layers', label: 'Layer stack',
  description: 'Stacked abstraction levels with what is enforced at each level.',
  whenToUse: 'Use when controls or concepts group by depth — UI to metal, policy to enforcement.',
  upstream: 'references/type-layers.md',
  defaults: { width: 840, height: 540 },
  inputSchema: {
    type: 'object', required: ['layers'],
    properties: { layers: { type: 'array', items: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, note: { type: 'string' } } } } },
  },
  render(spec, ctx) {
    const { svg, x, y, w, h } = ctx;
    const layers = spec.layers.slice(0, 6);
    const lh = (h - 8 * (layers.length - 1)) / layers.length;
    layers.forEach((l, i) => {
      const ly = y + i * (lh + 8);
      svg.rect(x, ly, w, lh, { fill: i === layers.length - 1 ? 'accentTint' : 'panel', stroke: 'rule', rx: 4 });
      svg.text(x + 20, ly + lh / 2 + 4, l.name, { size: 12.5, fill: 'ink', weight: 600 });
      if (l.note) svg.text(x + w - 20, ly + lh / 2 + 3, l.note, { size: 9, mono: true, fill: 'soft', anchor: 'end' });
    });
  },
};

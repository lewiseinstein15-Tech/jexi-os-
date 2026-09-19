/**
 * ER / data model — entities, fields, relationships. Upstream: type-er.md.
 * Editorial: crow's-foot edges in the link register, hairline field rules.
 */
export default {
  name: 'er', label: 'ER / data model',
  description: "Entities with fields and typed relationships in crow's-foot notation.",
  whenToUse: 'Use when the data model itself — entities, fields, cardinality — is the subject.',
  upstream: 'references/type-er.md',
  defaults: { width: 960, height: 520 },
  inputSchema: {
    type: 'object', required: ['entities', 'relations'],
    properties: {
      entities: { type: 'array', items: { type: 'object', required: ['name', 'fields'], properties: { name: { type: 'string' }, fields: { type: 'array', items: { type: 'string' } } } } },
      relations: { type: 'array', items: { type: 'object', required: ['from', 'to', 'card'], properties: { from: { type: 'string' }, to: { type: 'string' }, card: { type: 'string' } } } },
    },
  },
  render(spec, ctx) {
    const { svg, x, y, w, h } = ctx;
    const ents = spec.entities.slice(0, 4);
    const positions = [[x + 150, y + h * 0.28], [x + w - 150, y + h * 0.28], [x + 150, y + h * 0.76], [x + w - 150, y + h * 0.76]];
    const boxes = new Map();
    ents.forEach((e, i) => {
      const [cx, cy] = positions[i];
      const bw = Math.min(220, Math.max(160, 8 * 0.62 * Math.max(...e.fields.map((f) => f.length)) + 40));
      const bh = 30 + e.fields.length * 17;
      const bx = cx - bw / 2, by = cy - bh / 2;
      svg.rect(bx, by, bw, bh, { fill: 'panel', stroke: 'rule', rx: 4 });
      svg.rect(bx, by, bw, 26, { fill: 'panel3', stroke: 'rule', rx: 4 });
      svg.text(cx, by + 17, e.name, { size: 11.5, fill: 'ink', anchor: 'middle', weight: 600 });
      e.fields.slice(0, 7).forEach((f, fi) => {
        svg.text(bx + 12, by + 43 + fi * 17, f, { size: 9.5, mono: true, fill: 'muted' });
      });
      boxes.set(e.name, { bx, by, bw, bh });
    });
    for (const r of spec.relations) {
      const a = boxes.get(r.from), c = boxes.get(r.to);
      if (!a || !c) continue;
      const right = a.bx < c.bx;
      const ax = right ? a.bx + a.bw : a.bx, cx2 = right ? c.bx : c.bx + c.bw;
      svg.arrow(ax, a.by + a.bh / 2, cx2, c.by + c.bh / 2, { stroke: 'link', elbow: true, label: r.card, labelMono: true, labelColor: 'accent' });
    }
  },
};

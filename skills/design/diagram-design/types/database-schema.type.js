/**
 * Database schema — tables, typed columns, FK edges. Upstream: type-db-schema.md.
 * Editorial: mono column types in the soft register; FK arrows in link tone.
 */
export default {
  name: 'database-schema', label: 'Database schema',
  description: 'Tables with typed columns and foreign-key edges between them.',
  whenToUse: 'Use when the physical schema — columns, types, keys — is the subject.',
  upstream: 'references/type-db-schema.md',
  defaults: { width: 960, height: 520 },
  inputSchema: {
    type: 'object', required: ['tables'],
    properties: {
      tables: { type: 'array', items: { type: 'object', required: ['name', 'columns'], properties: { name: { type: 'string' }, columns: { type: 'array', items: { type: 'object', required: ['name', 'type'], properties: { name: { type: 'string' }, type: { type: 'string' }, pk: { type: 'boolean' }, fk: { type: 'string' } } } } } } },
    },
  },
  render(spec, ctx) {
    const { svg, x, y, w, h } = ctx;
    const tables = spec.tables.slice(0, 4);
    const posXY = [[x + 160, y + h * 0.3], [x + w - 160, y + h * 0.3], [x + 160, y + h * 0.78], [x + w - 160, y + h * 0.78]];
    const boxes = new Map();
    tables.forEach((t, i) => {
      const [cx, cy] = posXY[i];
      const bw = 230;
      const bh = 26 + t.columns.length * 16 + 6;
      const bx = cx - bw / 2, by = cy - bh / 2;
      svg.rect(bx, by, bw, bh, { fill: 'panel', stroke: 'rule', rx: 4 });
      svg.rect(bx, by, bw, 24, { fill: 'panel3', stroke: 'rule', rx: 4 });
      svg.text(bx + 12, by + 16, t.name, { size: 10.5, mono: true, fill: 'ink', weight: 600 });
      t.columns.slice(0, 8).forEach((c, ci) => {
        const cy2 = by + 40 + ci * 16;
        svg.text(bx + 12, cy2, (c.pk ? 'PK ' : c.fk ? 'FK ' : '   ') + c.name, { size: 9, mono: true, fill: c.pk ? 'accent' : c.fk ? 'gold' : 'ink' });
        svg.text(bx + bw - 12, cy2, c.type, { size: 9, mono: true, fill: 'soft', anchor: 'end' });
      });
      boxes.set(t.name, { bx, by, bw, bh });
    });
    for (const t of tables) for (const c of t.columns) {
      if (!c.fk || !boxes.has(c.fk)) continue;
      const a = boxes.get(t.name), b2 = boxes.get(c.fk);
      svg.arrow(a.bx + a.bw / 2, a.by > b2.by ? a.by : a.by + a.bh, b2.bx + b2.bw / 2, a.by > b2.by ? b2.by + b2.bh : b2.by, { stroke: 'link', elbow: true, sw: 0.9 });
    }
  },
};

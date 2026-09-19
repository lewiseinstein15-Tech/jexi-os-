/**
 * UML class — operations, inheritance, composition. Upstream: type-uml-class.md.
 * Editorial: three-compartment boxes, hollow-triangle inheritance, diamond composition.
 */
export default {
  name: 'uml-class', label: 'UML class',
  description: 'Classes with fields and operations; inheritance and composition drawn explicitly.',
  whenToUse: 'Use when static type structure — not runtime behavior — is the subject.',
  upstream: 'references/type-uml-class.md',
  defaults: { width: 960, height: 540 },
  inputSchema: {
    type: 'object', required: ['classes'],
    properties: {
      classes: { type: 'array', items: { type: 'object', required: ['name', 'fields', 'methods'], properties: { name: { type: 'string' }, fields: { type: 'array', items: { type: 'string' } }, methods: { type: 'array', items: { type: 'string' } } } } },
      inheritance: { type: 'array', items: { type: 'object', required: ['from', 'to'], properties: { from: { type: 'number' }, to: { type: 'number' } } } },
      composition: { type: 'array', items: { type: 'object', required: ['from', 'to'], properties: { from: { type: 'number' }, to: { type: 'number' } } } },
    },
  },
  render(spec, ctx) {
    const { svg, x, y, w, h } = ctx;
    const cls = spec.classes.slice(0, 4);
    const posXY = [[x + 170, y + h * 0.24], [x + w - 170, y + h * 0.24], [x + 170, y + h * 0.76], [x + w - 170, y + h * 0.76]];
    const boxes = new Map();
    cls.forEach((c, i) => {
      const [cx, cy] = posXY[i];
      const bw = 200;
      const bh = 26 + (c.fields.length + c.methods.length) * 15 + 10;
      const bx = cx - bw / 2, by = cy - bh / 2;
      svg.rect(bx, by, bw, bh, { fill: 'panel', stroke: 'rule', rx: 4 });
      svg.text(cx, by + 17, c.name, { size: 11.5, fill: 'ink', anchor: 'middle', weight: 600 });
      svg.line(bx, by + 26, bx + bw, by + 26, { stroke: 'rule', sw: 0.8 });
      let yy = by + 26;
      c.fields.slice(0, 4).forEach((f) => { yy += 15; svg.text(bx + 10, yy + 4, '+ ' + f, { size: 9, mono: true, fill: 'muted' }); });
      svg.line(bx, yy + 6, bx + bw, yy + 6, { stroke: 'rule', sw: 0.8 });
      c.methods.slice(0, 4).forEach((m) => { yy += 15; svg.text(bx + 10, yy + 10, '+ ' + m, { size: 9, mono: true, fill: 'muted' }); });
      boxes.set(i, { bx, by, bw, bh, cx, cy });
    });
    for (const rel of spec.inheritance || []) {
      const a = boxes.get(rel.from), c = boxes.get(rel.to);
      if (!a || !c) continue;
      svg.line(a.cx, a.cy, c.cx, c.cy, { stroke: 'muted' });
      const ang = Math.atan2(c.cy - a.cy, c.cx - a.cx);
      const tx = c.cx, ty = c.cy;
      svg.polygon([[tx, ty], [tx - 12 * Math.cos(ang - 0.35), ty - 12 * Math.sin(ang - 0.35)], [tx - 12 * Math.cos(ang + 0.35), ty - 12 * Math.sin(ang + 0.35)]], { fill: 'paper', stroke: 'ink', sw: 1 });
    }
    for (const rel of spec.composition || []) {
      const a = boxes.get(rel.from), c = boxes.get(rel.to);
      if (!a || !c) continue;
      svg.line(a.cx, a.cy, c.cx, c.cy, { stroke: 'muted', dash: '4 3' });
      svg.polygon([[c.cx, c.cy - 5], [c.cx - 9, c.cy], [c.cx, c.cy + 5], [c.cx + 9, c.cy]], { fill: 'ink' });
    }
  },
};

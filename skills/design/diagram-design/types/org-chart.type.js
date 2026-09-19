/**
 * Org chart — ownership and reporting. Upstream: type-org-chart.md.
 * Editorial: roles with a name register and a title register; escalations dashed.
 */
export default {
  name: 'org-chart', label: 'Org chart',
  description: 'Reporting structure: people/roles, solid lines report, dashed lines escalate.',
  whenToUse: 'Use when ownership, reporting, or routing of decisions is the subject.',
  upstream: 'references/type-org-chart.md',
  defaults: { width: 960, height: 520 },
  inputSchema: {
    type: 'object', required: ['people'],
    properties: { people: { type: 'array', items: { type: 'object', required: ['name', 'title'], properties: { name: { type: 'string' }, title: { type: 'string' }, reportsTo: { type: 'number' }, dashed: { type: 'boolean' } } } } },
  },
  render(spec, ctx) {
    const { svg, x, y, w, h } = ctx;
    const people = spec.people.slice(0, 10);
    const byParent = new Map();
    let root = null;
    people.forEach((p, i) => {
      if (p.reportsTo == null) root = i;
      else { if (!byParent.has(p.reportsTo)) byParent.set(p.reportsTo, []); byParent.get(p.reportsTo).push(i); }
    });
    const levels = new Map([[root, 0]]);
    const queue = [root];
    while (queue.length) {
      const id = queue.shift();
      for (const c of byParent.get(id) || []) { levels.set(c, levels.get(id) + 1); queue.push(c); }
    }
    const maxLevel = Math.max(...levels.values());
    const pos = new Map();
    const groups = new Map();
    people.forEach((p, i) => {
      const l = levels.get(i);
      if (!groups.has(l)) groups.set(l, []);
      groups.get(l).push(i);
    });
    for (const [l, ids] of groups) {
      ids.forEach((id, ii) => pos.set(id, { cx: x + ((w - 40) * (ii + 0.5)) / ids.length + 20, cy: y + 30 + ((h - 80) * l) / Math.max(1, maxLevel) }));
    }
    people.forEach((p, i) => {
      const q = pos.get(i);
      svg.rect(q.cx - 78, q.cy - 26, 156, 52, { fill: i === root ? 'panel3' : 'panel', stroke: 'rule', rx: 4 });
      svg.text(q.cx, q.cy - 6, p.name, { size: 11, fill: 'ink', anchor: 'middle', weight: 600 });
      svg.text(q.cx, q.cy + 12, p.title, { size: 8.5, mono: true, fill: 'soft', anchor: 'middle' });
    });
    for (const [parent, kids] of byParent) {
      const pp = pos.get(parent);
      for (const k of kids) {
        const kp = pos.get(k);
        const dashed = people[k].dashed;
        svg.polyline([[pp.cx, pp.cy + 26], [pp.cx, pp.cy + 38], [kp.cx, kp.cy + 38], [kp.cx, kp.cy - 27]], { stroke: dashed ? 'soft' : 'muted', sw: 0.9, dash: dashed ? '4 3' : null });
      }
    }
  },
};

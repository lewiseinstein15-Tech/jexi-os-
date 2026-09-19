/**
 * Tree — parent to children. Upstream: type-tree.md.
 * Editorial: tidy deterministic layout, elbow connectors, leaf strokes thin.
 */
export default {
  name: 'tree', label: 'Tree',
  description: 'A single parent decomposing into children and grandchildren with elbow connectors.',
  whenToUse: 'Use when a hierarchy has exactly one root and no cycles.',
  upstream: 'references/type-tree.md',
  defaults: { width: 960, height: 520 },
  inputSchema: {
    type: 'object', required: ['nodes'],
    properties: {
      nodes: { type: 'array', items: { type: 'object', required: ['id', 'label'], properties: { id: { type: 'number' }, label: { type: 'string' }, parent: { type: 'number' } } } },
    },
  },
  render(spec, ctx) {
    const { svg, x, y, w, h } = ctx;
    const nodes = spec.nodes.slice(0, 12);
    const byParent = new Map();
    let root = null;
    for (const n of nodes) {
      if (n.parent == null) { root = n.id; continue; }
      if (!byParent.has(n.parent)) byParent.set(n.parent, []);
      byParent.get(n.parent).push(n.id);
    }
    const depth = new Map([[root, 0]]);
    const queue = [root];
    while (queue.length) {
      const id = queue.shift();
      for (const c of byParent.get(id) || []) { depth.set(c, depth.get(id) + 1); queue.push(c); }
    }
    const maxDepth = Math.max(...depth.values());
    const leaves = nodes.filter((n) => !byParent.has(n.id)).length || 1;
    const posById = new Map();
    let leafX = 0;
    const place = (id, px) => {
      const kids = byParent.get(id) || [];
      const d = depth.get(id);
      if (!kids.length) {
        const cx = x + ((w - 80) * (leafX + 0.5)) / leaves + 40;
        leafX += 1;
        posById.set(id, { cx, cy: y + ((h - 40) * d) / Math.max(1, maxDepth) + 24 });
        return cx;
      }
      const cxs = kids.map((k) => place(k, px));
      const cx = (Math.min(...cxs) + Math.max(...cxs)) / 2;
      posById.set(id, { cx, cy: y + ((h - 40) * d) / Math.max(1, maxDepth) + 24 });
      return cx;
    };
    if (root != null) place(root, 0);
    for (const n of nodes) {
      const p = posById.get(n.id);
      if (!p) continue;
      const isLeaf = !byParent.has(n.id);
      svg.box(p.cx, p.cy, n.label, { fill: isLeaf ? 'paper' : 'panel', stroke: isLeaf ? 'line' : 'rule', sw: isLeaf ? 0.8 : 1, minW: 96, minH: 34, size: 10.5 });
    }
    for (const n of nodes) {
      const p = posById.get(n.id);
      for (const c of byParent.get(n.id) || []) {
        const cpos = posById.get(c);
        if (!p || !cpos) continue;
        svg.polyline([[p.cx, p.cy + 18], [p.cx, p.cy + 30], [cpos.cx, cpos.cy + 30], [cpos.cx, cpos.cy - 20]], { stroke: 'muted', sw: 0.9 });
        svg.arrowHead(cpos.cx, cpos.cy - 19, 270, { stroke: 'muted', size: 4 });
      }
    }
  },
};

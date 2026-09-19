/**
 * Dependency graph — what depends on what, fan-in and cycles. Upstream: type-dependency.md.
 * Editorial: deterministic layered ranking; the highest fan-in node is the accent.
 */
export default {
  name: 'dependency-graph', label: 'Dependency graph',
  description: 'Directed dependency layers with fan-in emphasis and honest cycle handling.',
  whenToUse: 'Use when what depends on what — and what everything leans on — is the subject.',
  upstream: 'references/type-dependency.md',
  defaults: { width: 960, height: 540 },
  inputSchema: {
    type: 'object', required: ['nodes', 'edges'],
    properties: {
      nodes: { type: 'array', items: { type: 'string' } },
      edges: { type: 'array', items: { type: 'object', required: ['from', 'to'], properties: { from: { type: 'number' }, to: { type: 'number' } } } },
    },
  },
  render(spec, ctx) {
    const { svg, x, y, w, h } = ctx;
    const n = Math.min(9, spec.nodes.length);
    const rank = Array(n).fill(0);
    for (let pass = 0; pass < n; pass++) for (const e of spec.edges) if (e.from < n && e.to < n && rank[e.to] <= rank[e.from]) rank[e.to] = rank[e.from] + 1;
    const maxRank = Math.max(...rank);
    const layers = Array.from({ length: maxRank + 1 }, () => []);
    rank.forEach((r, i) => layers[r].push(i));
    const fanIn = Array(n).fill(0);
    for (const e of spec.edges) if (e.to < n) fanIn[e.to]++;
    const hub = fanIn.indexOf(Math.max(...fanIn));
    const pos = new Map();
    layers.forEach((ids, li) => {
      ids.forEach((id, ii) => {
        pos.set(id, { cx: x + ((w - 40) * (li + 0.5)) / (maxRank + 1) + 20, cy: y + ((h - 16) * (ii + 0.5)) / ids.length + 8 });
      });
    });
    for (const e of spec.edges) {
      const a = pos.get(e.from), c = pos.get(e.to);
      if (!a || !c) continue;
      svg.arrow(a.cx + 55, a.cy, c.cx - 55, c.cy, { stroke: 'muted', elbow: true, sw: 0.9 });
    }
    for (const [id, p] of pos) {
      const focal = id === hub && fanIn[hub] > 0;
      svg.box(p.cx, p.cy, spec.nodes[id], { fill: focal ? 'accentTint' : 'panel', stroke: focal ? 'accent' : 'rule', minW: 108, minH: 36 });
      if (focal) svg.chip(p.cx, p.cy + 30, 'fan-in ' + fanIn[id], { color: 'accent', stroke: 'accent' });
    }
  },
};

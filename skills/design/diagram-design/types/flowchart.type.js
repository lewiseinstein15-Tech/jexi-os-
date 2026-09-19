/**
 * Flowchart — decision logic with branches. Upstream: references/type-flowchart.md.
 * Editorial: diamond decisions, ≤ 9 nodes, accent on the single focal path.
 */
export default {
  name: 'flowchart', label: 'Flowchart',
  description: 'Decision logic with branches: action nodes, diamond decisions, labeled yes/no edges.',
  whenToUse: 'Use when a process has real branching decisions a reader must follow step by step.',
  upstream: 'references/type-flowchart.md',
  defaults: { width: 960, height: 560 },
  inputSchema: {
    type: 'object', required: ['nodes', 'edges'],
    properties: {
      nodes: { type: 'array', items: { type: 'object', required: ['id', 'label'], properties: { id: { type: 'string' }, label: { type: 'string' }, kind: { type: 'string' } } } },
      edges: { type: 'array', items: { type: 'object', required: ['from', 'to'], properties: { from: { type: 'string' }, to: { type: 'string' }, label: { type: 'string' } } } },
      focal: { type: 'string' },
    },
  },
  render(spec, ctx) {
    const { svg, x, y, w, h } = ctx;
    const nodes = spec.nodes.slice(0, 9);
    const cols = Math.min(3, nodes.length);
    const rows = Math.ceil(nodes.length / cols);
    const cw = w / cols, rh = Math.min(110, (h - 30) / rows);
    const pos = new Map();
    nodes.forEach((n, i) => pos.set(n.id, { cx: x + cw * ((i % cols) + 0.5), cy: y + rh * Math.floor(i / cols) + rh / 2 }));
    for (const n of nodes) {
      const p = pos.get(n.id);
      if (n.kind === 'decision') {
        svg.polygon([[p.cx, p.cy - 32], [p.cx + 75, p.cy], [p.cx, p.cy + 32], [p.cx - 75, p.cy]], { fill: 'panel', stroke: 'ink', sw: 1 });
        svg.text(p.cx, p.cy + 4, n.label, { size: 11, fill: 'ink', anchor: 'middle', weight: 500 });
      } else {
        const focal = spec.focal === n.id;
        svg.box(p.cx, p.cy, n.label, { fill: focal ? 'accentTint' : 'panel', stroke: focal ? 'accent' : 'rule', color: 'ink', minW: 128, weight: focal ? 600 : 500 });
      }
    }
    for (const e of spec.edges) {
      const a = pos.get(e.from), c = pos.get(e.to);
      if (!a || !c) continue;
      const sameRow = Math.abs(a.cy - c.cy) < 4;
      const dx = c.cx > a.cx ? 1 : -1;
      svg.arrow(sameRow ? a.cx + dx * 70 : a.cx, sameRow ? a.cy : a.cy + 32, sameRow ? c.cx - dx * 70 : c.cx, sameRow ? c.cy : c.cy - 20, { stroke: 'muted', elbow: !sameRow, label: e.label, labelMono: true, labelColor: 'muted' });
    }
  },
};

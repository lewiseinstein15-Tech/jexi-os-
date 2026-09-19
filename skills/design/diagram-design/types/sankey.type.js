/**
 * Sankey — a quantity splitting and merging across stages. Upstream: type-sankey.md.
 * Editorial: ribbons in accent tint at hairline stroke; band width IS the amount.
 */
export default {
  name: 'sankey', label: 'Sankey',
  description: 'A quantity flowing left to right, splitting and merging; band width equals amount.',
  whenToUse: 'Use when how a total splits — and recombines — is the story.',
  upstream: 'references/type-sankey.md',
  defaults: { width: 960, height: 560 },
  inputSchema: {
    type: 'object', required: ['nodes', 'flows'],
    properties: {
      nodes: { type: 'array', items: { type: 'object', required: ['id', 'stage'], properties: { id: { type: 'string' }, stage: { type: 'number' } } } },
      flows: { type: 'array', items: { type: 'object', required: ['from', 'to', 'value'], properties: { from: { type: 'string' }, to: { type: 'string' }, value: { type: 'number' } } } },
    },
  },
  render(spec, ctx) {
    const { svg, x, y, w, h } = ctx;
    const stages = Math.max(...spec.nodes.map((n) => n.stage)) + 1;
    const totals = new Map();
    for (const f of spec.flows) { totals.set(f.from, (totals.get(f.from) || 0) + f.value); totals.set(f.to, (totals.get(f.to) || 0) + f.value); }
    const maxTotal = Math.max(...totals.values());
    const unit = (h - 40) / (maxTotal * 1.05);
    const byStage = Array.from({ length: stages }, () => []);
    for (const n of spec.nodes) byStage[n.stage].push(n.id);
    const nodeY = new Map(), nodeH = new Map(), nodeX = new Map();
    for (let s = 0; s < stages; s++) {
      const ids = byStage[s];
      const total = ids.reduce((a, id) => a + (totals.get(id) || 0), 0);
      let cy = y + (h - total * unit) / 2;
      for (const id of ids) {
        const nh = Math.max(6, (totals.get(id) || 0) * unit);
        nodeX.set(id, x + 60 + (w - 120) * (s / Math.max(1, stages - 1)));
        nodeY.set(id, cy); nodeH.set(id, nh);
        cy += nh + 18;
      }
    }
    const outCur = new Map(), inCur = new Map();
    for (const f of spec.flows) {
      const fh = Math.max(4, f.value * unit);
      const x1 = nodeX.get(f.from), x2 = nodeX.get(f.to);
      const y1 = (outCur.get(f.from) ?? nodeY.get(f.from)) + fh / 2;
      const y2 = (inCur.get(f.to) ?? nodeY.get(f.to)) + fh / 2;
      outCur.set(f.from, (outCur.get(f.from) ?? nodeY.get(f.from)) + fh);
      inCur.set(f.to, (inCur.get(f.to) ?? nodeY.get(f.to)) + fh);
      const mx = Math.round((x1 + x2) / 2);
      svg.path(`M ${Math.round(x1)} ${Math.round(y1 - fh / 2)} C ${mx} ${Math.round(y1 - fh / 2)}, ${mx} ${Math.round(y2 - fh / 2)}, ${Math.round(x2)} ${Math.round(y2 - fh / 2)} L ${Math.round(x2)} ${Math.round(y2 + fh / 2)} C ${mx} ${Math.round(y2 + fh / 2)}, ${mx} ${Math.round(y1 + fh / 2)}, ${Math.round(x1)} ${Math.round(y1 + fh / 2)} Z`, { fill: 'accentTint', stroke: 'accent', sw: 0.6 });
    }
    for (const n of spec.nodes) {
      const nx = nodeX.get(n.id), ny = nodeY.get(n.id), nh = nodeH.get(n.id);
      svg.rect(nx - 3, ny, 6, nh, { fill: 'ink', rx: 2 });
      svg.text(nx + 10, ny + nh / 2 + 3, n.id, { size: 9.5, mono: true, fill: 'ink' });
    }
  },
};

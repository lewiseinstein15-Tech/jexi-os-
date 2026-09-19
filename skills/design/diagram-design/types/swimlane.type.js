/**
 * Swimlane — cross-functional process with handoffs. Upstream: type-swimlane.md.
 * Editorial: lanes as quiet alternating bands; cross-lane handoffs are the only warm strokes.
 */
export default {
  name: 'swimlane', label: 'Swimlane',
  description: 'Cross-functional process across role lanes with explicit handoffs between lanes.',
  whenToUse: 'Use when who does what matters as much as the order of steps.',
  upstream: 'references/type-swimlane.md',
  defaults: { width: 960, height: 560 },
  inputSchema: {
    type: 'object', required: ['lanes', 'steps'],
    properties: {
      lanes: { type: 'array', items: { type: 'string' } },
      steps: { type: 'array', items: { type: 'object', required: ['lane', 'label', 'col'], properties: { lane: { type: 'number' }, label: { type: 'string' }, col: { type: 'number' } } } },
    },
  },
  render(spec, ctx) {
    const { svg, x, y, w, h } = ctx;
    const lanes = spec.lanes.slice(0, 4);
    const cols = Math.max(...spec.steps.map((s) => s.col)) + 1;
    const lw = 108, lh = (h - 8) / lanes.length, cw = (w - lw) / cols;
    lanes.forEach((lane, li) => {
      const ly = y + li * lh;
      svg.rect(x, ly, w, lh - 8, { fill: li % 2 ? 'panel' : 'paper2', rx: 4 });
      svg.text(x + 14, ly + lh / 2 - 2, lane, { size: 11, fill: 'ink', weight: 600 });
      svg.text(x + 14, ly + lh / 2 + 14, 'lane ' + (li + 1), { size: 8, mono: true, fill: 'soft', spacing: '0.08em' });
    });
    const centers = new Map();
    for (const s of spec.steps) {
      const cx = x + lw + cw * (s.col + 0.5);
      const cy = y + s.lane * lh + lh / 2 - 4;
      centers.set(s.label, { cx, cy });
      svg.box(cx, cy, s.label, { fill: 'paper', stroke: 'rule', minW: Math.min(150, cw - 18), minH: 36 });
    }
    const ordered = spec.steps.slice().sort((a, c) => a.col - c.col);
    for (let i = 0; i < ordered.length - 1; i++) {
      const a = centers.get(ordered[i].label), c = centers.get(ordered[i + 1].label);
      if (!a || !c) continue;
      const across = a.cy !== c.cy;
      svg.arrow(a.cx + (c.cx > a.cx ? 60 : -60), a.cy, c.cx - (c.cx > a.cx ? 62 : -62), c.cy, { stroke: across ? 'link' : 'muted', elbow: across, sw: across ? 1.2 : 1 });
    }
  },
};

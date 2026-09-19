/**
 * State machine — states, transitions, guards. Upstream: type-state.md.
 * Editorial: rx-6 states (never pills), guard labels in the mono register.
 */
export default {
  name: 'state-machine', label: 'State machine',
  description: 'States with transitions and guards, terminal states, and an explicit entry point.',
  whenToUse: 'Use when one subject moves through named states with guarded transitions.',
  upstream: 'references/type-state.md',
  defaults: { width: 960, height: 520 },
  inputSchema: {
    type: 'object', required: ['states', 'transitions'],
    properties: {
      initial: { type: 'string' },
      states: { type: 'array', items: { type: 'object', required: ['id', 'label'], properties: { id: { type: 'string' }, label: { type: 'string' }, terminal: { type: 'boolean' } } } },
      transitions: { type: 'array', items: { type: 'object', required: ['from', 'to'], properties: { from: { type: 'string' }, to: { type: 'string' }, guard: { type: 'string' } } } },
    },
  },
  render(spec, ctx) {
    const { svg, x, y, w, h } = ctx;
    const states = spec.states.slice(0, 7);
    const cols = Math.min(3, states.length);
    const rows = Math.ceil(states.length / cols);
    const cw = w / cols, rh = (h - 20) / rows;
    const pos = new Map();
    states.forEach((s, i) => pos.set(s.id, { cx: x + cw * ((i % cols) + 0.5), cy: y + rh * Math.floor(i / cols) + rh * 0.55 }));
    if (spec.initial && pos.get(spec.initial)) {
      const p = pos.get(spec.initial);
      svg.circle(p.cx - 90, p.cy, 5, { fill: 'ink' });
      svg.arrow(p.cx - 84, p.cy, p.cx - 62, p.cy, { stroke: 'muted' });
    }
    for (const s of states) {
      const p = pos.get(s.id);
      svg.box(p.cx, p.cy, s.label, { fill: s.terminal ? 'upTint' : 'panel', stroke: s.terminal ? 'up' : 'rule', minW: 132, minH: 40, weight: 500 });
    }
    for (const t of spec.transitions) {
      const a = pos.get(t.from), c = pos.get(t.to);
      if (!a || !c || a === c) continue;
      const sameRow = Math.abs(a.cy - c.cy) < 4;
      const dx = c.cx > a.cx ? 1 : -1;
      svg.arrow(sameRow ? a.cx + dx * 70 : a.cx, sameRow ? a.cy : a.cy + 22, sameRow ? c.cx - dx * 70 : c.cx, sameRow ? c.cy : c.cy - 22, { stroke: 'muted', elbow: !sameRow, label: t.guard, labelMono: true });
    }
  },
};

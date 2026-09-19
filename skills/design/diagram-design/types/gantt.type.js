/**
 * Gantt — tasks and phases on a timeline. Upstream: type-gantt.md.
 * Editorial: rows in the mono register, bars in panel tones, milestones as diamonds.
 */
export default {
  name: 'gantt', label: 'Gantt',
  description: 'Tasks with start/duration on a shared time scale, with milestones.',
  whenToUse: 'Use when a plan needs durations and overlaps, not a checklist.',
  upstream: 'references/type-gantt.md',
  defaults: { width: 960, height: 540 },
  inputSchema: {
    type: 'object', required: ['tasks'],
    properties: {
      tasks: { type: 'array', items: { type: 'object', required: ['label', 'start', 'dur'], properties: { label: { type: 'string' }, start: { type: 'number' }, dur: { type: 'number' }, milestone: { type: 'boolean' } } } },
      units: { type: 'number' },
    },
  },
  render(spec, ctx) {
    const { svg, x, y, w, h } = ctx;
    const tasks = spec.tasks.slice(0, 8);
    const units = spec.units || Math.max(...tasks.map((t) => t.start + t.dur));
    const labelW = 170;
    const plotW = w - labelW - 20;
    svg.axisX(x + labelW, y - 4, plotW, { ticks: [0, 0.25, 0.5, 0.75, 1].map((at) => ({ at, label: String(Math.round(units * at)) })) });
    const rowH = (h - 14) / tasks.length;
    tasks.forEach((t, i) => {
      const ry = y + i * rowH + rowH / 2;
      svg.text(x + 8, ry + 4, t.label, { size: 10, mono: true, fill: 'ink' });
      if (i % 2 === 0) svg.rect(x, ry - rowH / 2, w, rowH, { fill: 'panel', opacity: 0.4 });
      const bx = x + labelW + plotW * (t.start / units);
      const bw2 = Math.max(6, plotW * (t.dur / units));
      if (t.milestone) {
        svg.polygon([[bx, ry - 7], [bx + 7, ry], [bx, ry + 7], [bx - 7, ry]], { fill: 'accent' });
      } else {
        svg.rect(bx, ry - rowH * 0.24, bw2, rowH * 0.48, { fill: t.dur >= units * 0.4 ? 'panel3' : 'accentTint', stroke: t.dur >= units * 0.4 ? 'rule' : 'accent', rx: 2 });
      }
    });
  },
};

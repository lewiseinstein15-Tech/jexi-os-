/**
 * Waterfall — a start total bridged to an end total. Upstream: type-waterfall.md.
 * Editorial: positive deltas in up tone, negative in down; totals solid panels.
 */
export default {
  name: 'waterfall', label: 'Waterfall',
  description: 'A start total bridged to an end total by signed contributions.',
  whenToUse: 'Use when a budget bridge or headcount delta needs each contribution visible.',
  upstream: 'references/type-waterfall.md',
  defaults: { width: 960, height: 520 },
  inputSchema: {
    type: 'object', required: ['items'],
    properties: {
      items: { type: 'array', items: { type: 'object', required: ['label', 'value'], properties: { label: { type: 'string' }, value: { type: 'number' }, total: { type: 'boolean' } } } },
    },
  },
  render(spec, ctx) {
    const { svg, x, y, w, h } = ctx;
    const items = spec.items.slice(0, 8);
    let run = 0;
    const maxV = Math.max(...items.map((i) => (i.total ? Math.max(run + i.value, i.value) : run + Math.max(0, i.value))), 0);
    const scale = (h - 60) / Math.max(1, maxV);
    const cw = w / items.length;
    items.forEach((it, i) => {
      const cx = x + cw * (i + 0.5);
      let y0, y1, fill, stroke;
      if (it.total) { y0 = 0; y1 = it.value; fill = 'panel3'; stroke = 'rule'; run = it.value; }
      else {
        y0 = run; run += it.value; y1 = run;
        fill = it.value >= 0 ? 'upTint' : 'downTint'; stroke = it.value >= 0 ? 'up' : 'down';
      }
      const pyTop = y + (h - 40) - Math.max(y0, y1) * scale;
      const ph = Math.max(4, Math.abs(y1 - y0) * scale);
      svg.rect(cx - cw * 0.3, pyTop, cw * 0.6, ph, { fill, stroke, rx: 2 });
      if (i < items.length - 1) svg.line(cx + cw * 0.3, pyTop + (it.total ? ph : (it.value >= 0 ? 0 : ph)), x + cw * 1.2 - cw * 0.3 + (cw * 0.1), pyTop + (it.total ? ph : (it.value >= 0 ? 0 : ph)), { stroke: 'line', sw: 0.8, dash: '2 3' });
      svg.text(cx, pyTop - 6, it.total ? String(it.value) : (it.value >= 0 ? '+' : '') + String(it.value), { size: 9, mono: true, fill: it.total ? 'ink' : it.value >= 0 ? 'up' : 'down', anchor: 'middle' });
      svg.text(cx, y + h - 16, it.label, { size: 9, mono: true, fill: 'soft', anchor: 'middle' });
    });
  },
};

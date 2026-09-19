/**
 * Venn — overlap between sets. Upstream: type-venn.md.
 * Editorial: stroked circles, overlap tinted; set names serif-adjacent, counts mono.
 */
export default {
  name: 'venn', label: 'Venn',
  description: 'Two or three sets as circles with their overlap called out.',
  whenToUse: 'Use when the intersection — or the difference — of two sets is the story.',
  upstream: 'references/type-venn.md',
  defaults: { width: 760, height: 560 },
  inputSchema: {
    type: 'object', required: ['sets'],
    properties: {
      sets: { type: 'array', items: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, count: { type: 'number' } } } },
      overlap: { type: 'object', properties: { label: { type: 'string' }, count: { type: 'number' } } },
    },
  },
  render(spec, ctx) {
    const { svg, x, y, w, h } = ctx;
    const sets = spec.sets.slice(0, 3);
    const cx = x + w / 2, cy = y + h / 2 + 10, R = Math.min(w, h) / 2 - 60;
    const offs = sets.length === 2 ? [[-R / 2.4, 0], [R / 2.4, 0]] : [[-R / 2.6, -R / 5], [R / 2.6, -R / 5], [0, R / 2.2]];
    sets.forEach((s, i) => {
      const [ox, oy] = offs[i];
      svg.circle(cx + ox, cy + oy, R, { fill: i === 0 ? 'accentTint' : 'panel', stroke: 'ink', sw: 1 });
      svg.text(cx + ox * 1.75, cy + oy * 1.75 - R - 12, s.name, { size: 11.5, fill: 'ink', anchor: 'middle', weight: 600 });
      if (s.count != null) svg.text(cx + ox * 1.75, cy + oy * 1.75 - R + 6, String(s.count), { size: 10, mono: true, fill: 'soft', anchor: 'middle' });
    });
    if (spec.overlap) {
      svg.text(cx, cy - 4, spec.overlap.label || 'overlap', { size: 10.5, fill: 'ink', anchor: 'middle', weight: 600 });
      if (spec.overlap.count != null) svg.text(cx, cy + 14, String(spec.overlap.count), { size: 10, mono: true, fill: 'accent', anchor: 'middle' });
    }
  },
};

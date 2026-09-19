/**
 * Story map — activities, stories, release bands. Upstream: type-story-map.md.
 * Editorial: the walking skeleton on top; release bands as quiet horizontal tints.
 */
export default {
  name: 'story-map', label: 'Story map',
  description: 'Activities across the top, user stories beneath, release bands slicing horizontally.',
  whenToUse: 'Use when a backlog needs its spine: what ships first, and what the user does.',
  upstream: 'references/type-story-map.md',
  defaults: { width: 960, height: 560 },
  inputSchema: {
    type: 'object', required: ['activities'],
    properties: {
      activities: { type: 'array', items: { type: 'object', required: ['name', 'stories'], properties: { name: { type: 'string' }, stories: { type: 'array', items: { type: 'object', required: ['label', 'release'], properties: { label: { type: 'string' }, release: { type: 'number' } } } } } } },
      releases: { type: 'array', items: { type: 'string' } },
    },
  },
  render(spec, ctx) {
    const { svg, x, y, w, h } = ctx;
    const acts = spec.activities.slice(0, 5);
    const releases = spec.releases || ['release 1', 'release 2', 'release 3'];
    const cw = w / acts.length;
    const gridY = y + 30;
    const rowH = (h - 40) / 3;
    releases.forEach((r, ri) => {
      svg.rect(x, gridY + ri * rowH, w, rowH - 8, { fill: ri === 0 ? 'accentTint' : ri === 1 ? 'goldTint' : 'panel', opacity: ri === 0 ? 1 : 0.6, rx: 4 });
      svg.text(x + 8, gridY + ri * rowH + 14, r, { size: 8, mono: true, fill: 'soft', spacing: '0.08em', upper: true });
    });
    acts.forEach((a, ai) => {
      const cx = x + ai * cw + cw / 2;
      svg.box(cx, y, a.name, { fill: 'panel3', stroke: 'rule', minW: Math.min(160, cw - 16), minH: 32, weight: 600 });
      a.stories.slice(0, 3).forEach((s, si) => {
        const sy = gridY + si * rowH + rowH / 2;
        svg.box(cx, sy, s.label, { fill: 'paper', stroke: 'rule', minW: Math.min(150, cw - 24), minH: 30, size: 10 });
      });
    });
  },
};

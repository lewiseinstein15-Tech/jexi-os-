/**
 * IT current-state — legacy landscape by phase. Upstream: type-it-state.md.
 * Editorial: departments as columns, systems as quiet blocks; the modernization target accented.
 */
export default {
  name: 'it-state', label: 'IT current-state',
  description: 'The as-is landscape: systems grouped by department with lifecycle phase tags.',
  whenToUse: 'Use when documenting the before state of a modernization proposal.',
  upstream: 'references/type-it-state.md',
  defaults: { width: 960, height: 560 },
  inputSchema: {
    type: 'object', required: ['departments'],
    properties: {
      departments: { type: 'array', items: { type: 'object', required: ['name', 'systems'], properties: { name: { type: 'string' }, systems: { type: 'array', items: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, phase: { type: 'string' }, target: { type: 'boolean' } } } } } } },
    },
  },
  render(spec, ctx) {
    const { svg, x, y, w, h } = ctx;
    const deps = spec.departments.slice(0, 3);
    const cw = (w - 24 * (deps.length - 1)) / deps.length;
    deps.forEach((dep, di) => {
      const dx = x + di * (cw + 24);
      svg.rect(dx, y, cw, h, { fill: 'paper2', stroke: 'rule', sw: 0.8, rx: 6 });
      svg.text(dx + 16, y + 24, dep.name, { size: 11, fill: 'ink', weight: 600 });
      dep.systems.slice(0, 4).forEach((sys, si) => {
        const sy = y + 44 + si * ((h - 60) / 4);
        svg.rect(dx + 14, sy, cw - 28, (h - 60) / 4 - 12, { fill: sys.target ? 'accentTint' : 'panel', stroke: sys.target ? 'accent' : 'rule', rx: 4 });
        svg.text(dx + 26, sy + 22, sys.name, { size: 10.5, fill: 'ink', weight: 500 });
        svg.text(dx + 26, sy + 38, sys.phase || 'run', { size: 8, mono: true, fill: sys.target ? 'accent' : 'soft', spacing: '0.08em', upper: true });
      });
    });
  },
};

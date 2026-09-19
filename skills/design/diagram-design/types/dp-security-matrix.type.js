/**
 * DP security matrix — per-role access permissions. Upstream: type-dp-security-matrix.md.
 * Editorial: grid cells read/write/none as filled half / stroke / empty; legend strip.
 */
export default {
  name: 'dp-security-matrix', label: 'Security matrix',
  description: 'Roles x components access matrix: read, write, or none.',
  whenToUse: 'Use when who can touch what needs one glance.',
  upstream: 'references/type-dp-security-matrix.md',
  defaults: { width: 840, height: 560 },
  inputSchema: {
    type: 'object', required: ['roles', 'components', 'grants'],
    properties: {
      roles: { type: 'array', items: { type: 'string' } },
      components: { type: 'array', items: { type: 'string' } },
      grants: { type: 'array', items: { type: 'object', required: ['role', 'component', 'access'], properties: { role: { type: 'number' }, component: { type: 'number' }, access: { type: 'string' } } } },
    },
  },
  render(spec, ctx) {
    const { svg, x, y, w, h } = ctx;
    const roles = spec.roles.slice(0, 5);
    const comps = spec.components.slice(0, 5);
    const cw = (w - 160) / comps.length, rh = (h - 60) / roles.length;
    comps.forEach((c, ci) => svg.text(x + 160 + cw * (ci + 0.5), y + 2, c, { size: 8.5, mono: true, fill: 'soft', anchor: 'middle', upper: true }));
    roles.forEach((r, ri) => {
      const ry = y + 20 + ri * rh + rh / 2;
      svg.text(x + 150, ry + 4, r, { size: 10, fill: 'ink', anchor: 'end', weight: 500 });
      comps.forEach((_, ci) => {
        const g = spec.grants.find((g2) => g2.role === ri && g2.component === ci);
        const gx = x + 160 + ci * cw + cw / 2, gy = ry;
        if (!g || g.access === 'none') svg.rect(gx - 14, gy - 14, 28, 28, { fill: 'panel', stroke: 'line', sw: 0.8, rx: 2 });
        else if (g.access === 'read') svg.rect(gx - 14, gy - 14, 28, 28, { fill: 'paper', stroke: 'muted', sw: 1, rx: 2 });
        else svg.rect(gx - 14, gy - 14, 28, 28, { fill: 'accentTint', stroke: 'accent', sw: 1.2, rx: 2 });
        if (g && g.access === 'write') svg.text(gx, gy + 3.5, 'w', { size: 9.5, mono: true, fill: 'accent', anchor: 'middle' });
      });
    });
    const ly = y + h - 24;
    svg.rect(x + 160, ly - 7, 16, 14, { fill: 'paper', stroke: 'muted', sw: 1, rx: 2 });
    svg.text(x + 184, ly + 4, 'read', { size: 8.5, mono: true, fill: 'soft' });
    svg.rect(x + 236, ly - 7, 16, 14, { fill: 'accentTint', stroke: 'accent', sw: 1.2, rx: 2 });
    svg.text(x + 260, ly + 4, 'write', { size: 8.5, mono: true, fill: 'soft' });
    svg.rect(x + 312, ly - 7, 16, 14, { fill: 'panel', stroke: 'line', sw: 0.8, rx: 2 });
    svg.text(x + 336, ly + 4, 'none', { size: 8.5, mono: true, fill: 'soft' });
  },
};

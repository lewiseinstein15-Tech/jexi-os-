/**
 * Architecture — components and connections in zones. Upstream: type-architecture.md.
 * Editorial: trust-boundary zones quiet; the single accent marks the critical path.
 */
export default {
  name: 'architecture', label: 'Architecture',
  description: 'System components grouped into zones with labeled connections and one critical path.',
  whenToUse: 'Use when components, boundaries, and how they connect is the whole story.',
  upstream: 'references/type-architecture.md',
  defaults: { width: 960, height: 560 },
  inputSchema: {
    type: 'object', required: ['zones', 'connections'],
    properties: {
      zones: { type: 'array', items: { type: 'object', required: ['name', 'components'], properties: { name: { type: 'string' }, components: { type: 'array', items: { type: 'string' } } } } },
      connections: { type: 'array', items: { type: 'object', required: ['from', 'to'], properties: { from: { type: 'string' }, to: { type: 'string' }, label: { type: 'string' } } } },
      critical: { type: 'string' },
    },
  },
  render(spec, ctx) {
    const { svg, x, y, w, h } = ctx;
    const zones = spec.zones.slice(0, 3);
    const zw = (w - 12 * (zones.length - 1)) / zones.length;
    const where = new Map();
    zones.forEach((zone, zi) => {
      const zx = x + zi * (zw + 12);
      svg.rect(zx, y, zw, h, { fill: 'paper2', stroke: 'rule', sw: 0.8, rx: 6 });
      svg.chip(zx + 14, y + 16, zone.name, { color: 'ink' });
      const comps = zone.components.slice(0, 3);
      comps.forEach((c, ci) => {
        const cy = y + 56 + ((h - 80) * (ci + 0.5)) / comps.length;
        where.set(c, { cx: zx + zw / 2, cy });
        const focal = spec.critical === c;
        svg.box(zx + zw / 2, cy, c, { fill: focal ? 'accentTint' : 'panel', stroke: focal ? 'accent' : 'rule', minW: Math.min(190, zw - 40), minH: 40 });
      });
    });
    for (const conn of spec.connections) {
      const a = where.get(conn.from), c = where.get(conn.to);
      if (!a || !c) continue;
      svg.arrow(a.cx + (c.cx > a.cx ? 95 : -95), a.cy, c.cx + (c.cx > a.cx ? -95 : 95), c.cy, { stroke: 'link', label: conn.label, labelMono: true, sw: 1 });
    }
  },
};

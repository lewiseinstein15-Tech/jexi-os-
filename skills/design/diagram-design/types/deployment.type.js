/**
 * Deployment — where software runs. Upstream: type-deployment.md.
 * Editorial: zone containers quiet, replicas as small blocks, ports in mono.
 */
export default {
  name: 'deployment', label: 'Deployment',
  description: 'Zones, hosts, artifacts, replicas, and ports — where software actually runs.',
  whenToUse: 'Use when the runtime topology, not the logic, is the subject.',
  upstream: 'references/type-deployment.md',
  defaults: { width: 960, height: 560 },
  inputSchema: {
    type: 'object', required: ['zones'],
    properties: {
      zones: { type: 'array', items: { type: 'object', required: ['name', 'hosts'], properties: { name: { type: 'string' }, hosts: { type: 'array', items: { type: 'object', required: ['name', 'artifacts'], properties: { name: { type: 'string' }, artifacts: { type: 'array', items: { type: 'string' } } } } } } } },
    },
  },
  render(spec, ctx) {
    const { svg, x, y, w, h } = ctx;
    const zones = spec.zones.slice(0, 3);
    const zw = (w - 12 * (zones.length - 1)) / zones.length;
    zones.forEach((zone, zi) => {
      const zx = x + zi * (zw + 12);
      svg.rect(zx, y, zw, h, { fill: 'paper2', stroke: 'rule', sw: 0.8, rx: 6 });
      svg.chip(zx + 14, y + 16, zone.name, { color: 'ink', stroke: 'rule' });
      const hw = zw - 32;
      zone.hosts.slice(0, 2).forEach((host, hi) => {
        const hy = y + 40 + hi * (h / 2 - 20);
        const hh = h / 2 - 52;
        svg.rect(zx + 16, hy, hw, hh, { fill: 'panel', stroke: 'rule', rx: 4 });
        svg.text(zx + 28, hy + 20, host.name, { size: 10.5, mono: true, fill: 'ink', weight: 600 });
        host.artifacts.slice(0, 3).forEach((art, ai) => {
          const ay = hy + 36 + ai * 40;
          const [label, port] = String(art).split(':');
          svg.rect(zx + 28, ay, hw - 24, 32, { fill: 'paper', stroke: 'rule', rx: 4 });
          svg.text(zx + 40, ay + 20, label, { size: 10, fill: 'ink', weight: 500 });
          if (port) svg.text(zx + 16 + hw - 40, ay + 20, ':' + port, { size: 9, mono: true, fill: 'soft', anchor: 'end' });
        });
      });
    });
  },
};

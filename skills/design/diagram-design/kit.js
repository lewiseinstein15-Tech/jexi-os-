/**
 * JEXI OS — Phase 17 Scope H — DIAGRAM DESIGN / SVG KIT.
 *
 * Editorial primitives shared by all 40 types. Implements the upstream
 * diagram-design style contract (MIT, cathrynlavery/diagram-design
 * references/style-guide.md) mapped onto JEXI Market tokens:
 *
 *   - text width budget: 0.60em/char sans, 0.62em mono, 1em wide chars,
 *     box width rounded up to the next multiple of 4
 *   - strokes: 0.8 thin (tags/leaf) · 1 default · 1.2 strong
 *   - radii: 4 small tags · 6 node boxes (never more on boxes)
 *   - NO drop shadows, NO filters, color functional (accent ≤ 2 focal uses)
 *   - whitespace is a feature: generous margins, content never touches edges
 *
 * Everything is deterministic: same spec + brand → byte-identical SVG.
 */

/** XML-escape text content and attribute values. */
export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** Upstream width budget: wide/full-width chars cost 1em, else face advance. */
export function textWidth(s, size, { mono = false } = {}) {
  let em = 0;
  for (const ch of String(s ?? '')) {
    const c = ch.codePointAt(0);
    const wide = (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf)
      || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff)
      || (c >= 0xfe30 && c <= 0xfe6f) || (c >= 0xff00 && c <= 0xff60) || (c >= 0xffe0 && c <= 0xffe6);
    em += wide ? 1 : mono ? 0.62 : 0.60;
  }
  return em * size;
}

/** Round up to the next multiple of 4 (upstream grid rule). */
export function round4(n) {
  return Math.max(4, Math.ceil(Number(n) / 4) * 4);
}

/** Concentric layout numbers shared across types. */
export const STROKE = Object.freeze({ thin: 0.8, default: 1, strong: 1.2 });
export const RADIUS = Object.freeze({ sm: 4, md: 6, lg: 8 });

/** Scene accumulator — elements serialize in insertion order. */
export class Svg {
  constructor() { this.parts = []; }
  raw(s) { this.parts.push(s); return this; }
  text(x, y, str, o = {}) {
    const size = o.size ?? 12;
    const mono = o.mono ?? false;
    const attrs = [
      `x="${round4(x)}"`, `y="${Math.round(y)}"`,
      `font-family="${mono ? 'mono' : 'sans'}"`, `font-size="${size}"`,
      o.weight ? `font-weight="${o.weight}"` : null,
      o.anchor && o.anchor !== 'start' ? `text-anchor="${o.anchor}"` : null,
      o.fill ? `fill="${o.fill}"` : null,
      o.spacing ? `letter-spacing="${o.spacing}"` : null,
      o.style || null,
    ].filter(Boolean).join(' ');
    this.parts.push(`<text ${attrs}>${esc(o.upper ? String(str).toUpperCase() : str)}</text>`);
    return this;
  }
  rect(x, y, w, h, o = {}) {
    const attrs = [
      `x="${round4(x)}"`, `y="${Math.round(y)}"`, `width="${round4(w)}"`, `height="${Math.round(h)}"`,
      o.fill ? `fill="${o.fill}"` : 'fill="none"',
      o.stroke ? `stroke="${o.stroke}" stroke-width="${o.sw ?? STROKE.default}"` : null,
      o.rx ? `rx="${o.rx}"` : null,
      o.dash ? `stroke-dasharray="${o.dash}"` : null,
      o.opacity ? `opacity="${o.opacity}"` : null,
    ].filter(Boolean).join(' ');
    this.parts.push(`<rect ${attrs}/>`);
    return this;
  }
  line(x1, y1, x2, y2, o = {}) {
    const attrs = [
      `x1="${Math.round(x1)}"`, `y1="${Math.round(y1)}"`, `x2="${Math.round(x2)}"`, `y2="${Math.round(y2)}"`,
      `stroke="${o.stroke}"`, `stroke-width="${o.sw ?? STROKE.default}"`,
      o.dash ? `stroke-dasharray="${o.dash}"` : null,
    ].filter(Boolean).join(' ');
    this.parts.push(`<line ${attrs}/>`);
    return this;
  }
  path(d, o = {}) {
    const attrs = [
      `d="${d}"`, `fill="${o.fill ?? 'none'}"`,
      o.stroke ? `stroke="${o.stroke}" stroke-width="${o.sw ?? STROKE.default}"` : null,
      o.dash ? `stroke-dasharray="${o.dash}"` : null,
      o.linecap ? `stroke-linecap="${o.linecap}"` : null,
    ].filter(Boolean).join(' ');
    this.parts.push(`<path ${attrs}/>`);
    return this;
  }
  circle(cx, cy, r, o = {}) {
    const attrs = [
      `cx="${Math.round(cx)}"`, `cy="${Math.round(cy)}"`, `r="${r}"`,
      `fill="${o.fill ?? 'none'}"`,
      o.stroke ? `stroke="${o.stroke}" stroke-width="${o.sw ?? STROKE.default}"` : null,
    ].filter(Boolean).join(' ');
    this.parts.push(`<circle ${attrs}/>`);
    return this;
  }
  polygon(points, o = {}) {
    const attrs = [
      `points="${points.map((p) => `${Math.round(p[0])},${Math.round(p[1])}`).join(' ')}"`,
      `fill="${o.fill ?? 'none'}"`,
      o.stroke ? `stroke="${o.stroke}" stroke-width="${o.sw ?? STROKE.default}"` : null,
    ].filter(Boolean).join(' ');
    this.parts.push(`<polygon ${attrs}/>`);
    return this;
  }
  polyline(points, o = {}) {
    const attrs = [
      `points="${points.map((p) => `${Math.round(p[0])},${Math.round(p[1])}`).join(' ')}"`,
      `fill="none"`, `stroke="${o.stroke}"`, `stroke-width="${o.sw ?? STROKE.default}"`,
      o.dash ? `stroke-dasharray="${o.dash}"` : null,
    ].filter(Boolean).join(' ');
    this.parts.push(`<polyline ${attrs}/>`);
    return this;
  }
  /** Explicit arrowhead triangle (no <marker> — keeps output deterministic). */
  arrowHead(x, y, angle, { stroke, size = 5 }) {
    const a = (angle * Math.PI) / 180;
    const p = (dx, dy) => `${Math.round(x + dx * Math.cos(a) - dy * Math.sin(a))},${Math.round(y + dx * Math.sin(a) + dy * Math.cos(a))}`;
    this.parts.push(`<polygon points="${p(0, 0)} ${p(-size * 2, -size)} ${p(-size * 2, size)}" fill="${stroke}"/>`);
    return this;
  }
  /** Straight or elbow (H-V-H) edge with optional mono label chip. */
  arrow(x1, y1, x2, y2, o = {}) {
    const stroke = o.stroke ?? 'muted';
    const pts = o.elbow ? [[x1, y1], [x1 + (x2 - x1) / 2, y1], [x1 + (x2 - x1) / 2, y2], [x2, y2]] : [[x1, y1], [x2, y2]];
    if (o.elbow) this.polyline(pts, { stroke, sw: o.sw ?? STROKE.default, dash: o.dash });
    else this.line(x1, y1, x2, y2, { stroke, sw: o.sw ?? STROKE.default, dash: o.dash });
    const last = pts[pts.length - 1], prev = pts[pts.length - 2];
    const angle = (Math.atan2(last[1] - prev[1], last[0] - prev[0]) * 180) / Math.PI;
    this.arrowHead(last[0], last[1], angle, { stroke, size: o.head ?? 5 });
    if (o.label != null) {
      const mx = o.labelAt ? o.labelAt[0] : (x1 + x2) / 2;
      const my = o.labelAt ? o.labelAt[1] : (y1 + y2) / 2 - 6;
      this.chip(mx, my, o.label, { mono: o.labelMono, fill: o.labelFill ?? 'paper', stroke: o.labelStroke ?? 'rule', color: o.labelColor });
    }
    return this;
  }
  /** Node box: centered label, width from the text budget (min given). */
  box(cx, cy, label, o = {}) {
    const mono = o.mono ?? false;
    const size = o.size ?? 12;
    const w = o.w ?? round4(Math.max(o.minW ?? 88, textWidth(label, size, { mono }) + (o.padX ?? 28)));
    const h = o.h ?? (o.minH ?? 36);
    const x = cx - w / 2, y = cy - h / 2;
    this.rect(x, y, w, h, { fill: o.fill ?? 'panel', stroke: o.stroke ?? 'rule', sw: o.sw ?? STROKE.default, rx: o.rx ?? RADIUS.md });
    this.text(cx, cy + size * 0.35, label, { size, mono, fill: o.color ?? 'ink', anchor: 'middle', weight: o.weight });
    return { x, y, w, h, cx, cy };
  }
  /** Uppercase mono tag chip (register: 7.5px, tracked, hairline border). */
  chip(x, y, label, o = {}) {
    const size = o.size ?? 7.5;
    const txt = String(label).toUpperCase();
    const w = round4(textWidth(txt, size, { mono: true }) + 12);
    const h = o.h ?? 15;
    this.rect(x - w / 2, y - h / 2, w, h, { fill: o.fill ?? 'paper', stroke: o.stroke ?? 'rule', sw: STROKE.thin, rx: RADIUS.sm });
    this.text(x, y + size * 0.38, txt, { size, mono: true, fill: o.color ?? 'muted', anchor: 'middle', spacing: '0.06em' });
    return { w, h };
  }
  /** Horizontal axis with ticks + mono tick labels (register switch). */
  axisX(x, y, len, { ticks = [], color = 'soft' } = {}) {
    this.line(x, y, x + len, y, { stroke: color, sw: STROKE.default });
    for (const t of ticks) {
      const tx = x + len * t.at;
      this.line(tx, y, tx, y + 4, { stroke: color, sw: STROKE.thin });
      if (t.label != null) this.text(tx, y + 14, t.label, { size: 8, mono: true, fill: color, anchor: 'middle' });
    }
    return this;
  }
  axisY(x, y, len, { ticks = [], color = 'soft' } = {}) {
    this.line(x, y, x, y + len, { stroke: color, sw: STROKE.default });
    for (const t of ticks) {
      const ty = y + len * (1 - t.at);
      this.line(x - 4, ty, x, ty, { stroke: color, sw: STROKE.thin });
      if (t.label != null) this.text(x - 7, ty + 3, t.label, { size: 8, mono: true, fill: color, anchor: 'end' });
    }
    return this;
  }
  /** Serialize with the palette applied: color names → hex from brand. */
  toString(b) {
    const colorFor = (v) => (typeof v === 'string' && v.startsWith('#') ? v : b[v] || v);
    return this.parts.map((p) => p
      .replace(/(fill|stroke)="(paper|panel|panel2|panel3|line|lineSoft|ink|ink2|ink3|muted|soft|accent|coral|peach|sand|gold|up|down|link|accentTint|upTint|downTint|goldTint)"/g, (_, a, name) => `${a}="${colorFor(name)}"`)
      .replace(/font-family="(sans|mono|display)"/g, (_, f) => `font-family="${esc(b.fonts[f])}"`))
      .join('\n');
  }
}

/** Small helpers shared by types. */
export const helpers = {
  /** Distribute n centers evenly across [x, x+len]. */
  spread(x, len, n) {
    return Array.from({ length: n }, (_, i) => x + (len * (i + 0.5)) / n);
  },
  /** Simple deterministic topological-ish ranking (for layered layouts). */
  rank(nodes, edges) {
    const r = new Map(nodes.map((n) => [n.id, 0]));
    for (let pass = 0; pass < nodes.length; pass++) {
      for (const e of edges) {
        const a = r.get(e.from), b = r.get(e.to);
        if (a != null && b != null && b <= a) r.set(e.to, a + 1);
      }
    }
    return r;
  },
};

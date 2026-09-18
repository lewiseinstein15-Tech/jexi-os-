#!/usr/bin/env node
/**
 * diagram-design — REAL deterministic SVG renderer (dependency-free).
 * Ported philosophy + tokens from cathrynlavery/diagram-design (MIT).
 * Scripted renderers: flowchart, sequence, state, timeline, swimlane,
 * pyramid, venn, quadrant. The other 32 catalog types exit with an honest
 * RENDERER_NOT_IMPLEMENTED + the reference file to follow.
 *
 * Usage:
 *   node render-diagram.mjs --list-types
 *   node render-diagram.mjs --type flowchart --spec spec.json --out out.svg
 *   cat spec.json | node render-diagram.mjs --type flowchart --out out.svg
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Editorial tokens (style-guide.md — single source of truth)
const T = {
  paper: '#f5f5f5', paper2: '#ececec', ink: '#2d3142', muted: '#4f5d75',
  soft: '#7a8399', rule: 'rgba(45,49,66,0.12)', ruleSolid: '#bfc0c0',
  accent: '#eb6c36', accentTint: 'rgba(235,108,54,0.08)', link: '#2e5aa8',
};
const FONT = `system-ui, -apple-system, 'Segoe UI', sans-serif`;
const MONO = `ui-monospace, 'SF Mono', Menlo, monospace`;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function svgDoc(w, h, body, title) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="${FONT}" role="img" aria-label="${esc(title || 'diagram')}">
<rect width="${w}" height="${h}" fill="${T.paper}"/>
${body}
</svg>`;
}
const box = (x, y, w, h, label, { focal = false, mono = false, sub = null } = {}) => `
<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${focal ? T.accentTint : '#ffffff'}" stroke="${focal ? T.accent : T.ruleSolid}" stroke-width="${focal ? 2 : 1}"/>
<text x="${x + w / 2}" y="${y + h / 2 + (sub ? -3 : 4)}" text-anchor="middle" font-size="13" fill="${T.ink}" ${mono ? `font-family="${MONO}"` : ''}>${esc(label)}</text>
${sub ? `<text x="${x + w / 2}" y="${y + h / 2 + 14}" text-anchor="middle" font-size="10" fill="${T.soft}">${esc(sub)}</text>` : ''}`;
const arrowMarker = () => `<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${T.muted}"/></marker></defs>`;
const arrow = (x1, y1, x2, y2, { label = null, link = false } = {}) => {
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${link ? T.link : T.muted}" stroke-width="1.5" marker-end="url(#arr)"/>
${label ? `<text x="${mx}" y="${my - 5}" text-anchor="middle" font-size="10" fill="${T.soft}">${esc(label)}</text>` : ''}`;
};

// ---------- renderers: (spec) => { w, h, body, title } ----------

function flowchart(spec) {
  const nodes = spec.nodes, edges = spec.edges;
  const NW = 150, NH = 44, GX = 60, GY = 70, M = 40;
  // longest-path layering from roots
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const incoming = Object.fromEntries(nodes.map((n) => [n.id, 0]));
  edges.forEach((e) => { incoming[e.to] = (incoming[e.to] || 0) + 1; });
  const level = {};
  const roots = nodes.filter((n) => !incoming[n.id]);
  (roots.length ? roots : [nodes[0]]).forEach((n) => { level[n.id] = 0; });
  for (let i = 0; i < nodes.length; i += 1) {
    for (const e of edges) {
      if (level[e.from] !== undefined && (level[e.to] === undefined || level[e.to] <= level[e.from])) level[e.to] = level[e.from] + 1;
    }
  }
  const maxLevel = Math.max(...Object.values(level));
  const perLevel = {};
  nodes.forEach((n) => { (perLevel[level[n.id]] ||= []).push(n); });
  const width = Math.max(...Object.values(perLevel).map((a) => a.length));
  const w = M * 2 + width * NW + (width - 1) * GX;
  const h = M * 2 + (maxLevel + 1) * NH + maxLevel * GY;
  const pos = {};
  for (const [lv, arr] of Object.entries(perLevel)) {
    const totalW = arr.length * NW + (arr.length - 1) * GX;
    arr.forEach((n, i) => { pos[n.id] = { x: M + (w - 2 * M - totalW) / 2 + i * (NW + GX), y: M + Number(lv) * (NH + GY) }; });
  }
  const body = arrowMarker()
    + nodes.map((n) => box(pos[n.id].x, pos[n.id].y, NW, NH, n.label, { focal: !!n.focal, sub: n.sub })).join('')
    + edges.map((e) => {
      const a = pos[e.from], b = pos[e.to];
      return arrow(a.x + NW / 2, a.y + NH, b.x + NW / 2, b.y, { label: e.label, link: !!e.link });
    }).join('');
  return { w, h, body, title: spec.title };
}

function sequence(spec) {
  const actors = spec.actors, msgs = spec.messages;
  const AW = 120, M = 30, TOP = 60, STEP = 52;
  const w = M * 2 + actors.length * AW;
  const h = TOP + 40 + msgs.length * STEP + 30;
  const cx = (i) => M + AW / 2 + i * AW;
  const idx = Object.fromEntries(actors.map((a, i) => [a, i]));
  const body = arrowMarker()
    + actors.map((a, i) => `
<rect x="${M + i * AW + 10}" y="${M}" width="${AW - 20}" height="34" rx="6" fill="#ffffff" stroke="${T.ruleSolid}"/>
<text x="${cx(i)}" y="${M + 21}" text-anchor="middle" font-size="12" fill="${T.ink}">${esc(a)}</text>
<line x1="${cx(i)}" y1="${M + 34}" x2="${cx(i)}" y2="${h - 24}" stroke="${T.rule}" stroke-width="1" stroke-dasharray="4 4"/>`).join('')
    + msgs.map((m, j) => {
      const y = TOP + j * STEP + 20;
      const x1 = cx(idx[m.from]), x2 = cx(idx[m.to]);
      const ret = m.kind === 'return';
      return `
<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${ret ? T.soft : T.muted}" stroke-width="1.5" ${ret ? 'stroke-dasharray="5 4"' : ''} marker-end="url(#arr)"/>
<text x="${(x1 + x2) / 2}" y="${y - 6}" text-anchor="middle" font-size="11" fill="${T.ink}">${esc(m.label)}${m.kind === 'async' ? ' ⟂' : ''}</text>`;
    }).join('');
  return { w, h, body, title: spec.title };
}

function state(spec) {
  const states = spec.states, transitions = spec.transitions;
  const n = states.length, R = Math.max(140, n * 34), M = 70;
  const w = h = 2 * M + 2 * R;
  const cx0 = w / 2, cy0 = h / 2;
  const pos = {};
  states.forEach((s, i) => {
    const a = (i / n) * 2 * Math.PI - Math.PI / 2;
    pos[s.id] = { x: cx0 + R * Math.cos(a), y: cy0 + R * Math.sin(a), label: s.label, start: !!s.start };
  });
  const body = arrowMarker()
    + (spec.transitions.some((t) => t.from === '__start')
      ? `<circle cx="${cx0}" cy="${M - 26}" r="6" fill="${T.ink}"/><line x1="${cx0}" y1="${M - 20}" x2="${pos[spec.transitions.find((t) => t.from === '__start').to].x}" y2="${pos[spec.transitions.find((t) => t.from === '__start').to].y - 24}" stroke="${T.muted}" stroke-width="1.5" marker-end="url(#arr)"/>` : '')
    + states.map((s) => {
      const p = pos[s.id];
      const fill = s.start ? T.accentTint : '#ffffff', stroke = s.start ? T.accent : T.ruleSolid;
      const lbl = esc(p.label), lw = Math.max(70, lbl.length * 8 + 24);
      return `<rect x="${p.x - lw / 2}" y="${p.y - 20}" width="${lw}" height="40" rx="20" fill="${fill}" stroke="${stroke}" stroke-width="${s.start ? 2 : 1}"/>
<text x="${p.x}" y="${p.y + 4}" text-anchor="middle" font-size="12" fill="${T.ink}">${lbl}</text>`;
    }).join('')
    + transitions.filter((t) => t.from !== '__start').map((t) => {
      const a = pos[t.from], b = pos[t.to];
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
      const trim = 42;
      return arrow(a.x + (dx / len) * trim, a.y + (dy / len) * trim, b.x - (dx / len) * (trim + 6), b.y - (dy / len) * (trim + 6), { label: t.label });
    }).join('');
  return { w, h, body, title: spec.title };
}

function timeline(spec) {
  const events = spec.events, M = 60;
  const STEP = Math.max(120, 900 / events.length);
  const w = M * 2 + (events.length - 1) * STEP;
  const h = 220;
  const y = h / 2;
  const body = events.map((e, i) => {
    const x = M + i * STEP, up = i % 2 === 0;
    const sy = up ? y - 34 : y + 34, ty = up ? y - 76 : y + 62;
    return `
<circle cx="${x}" cy="${y}" r="5" fill="${e.focal ? T.accent : T.ink}"/>
<line x1="${x}" y1="${y + (up ? -5 : 5)}" x2="${x}" y2="${sy + (up ? -8 : 8)}" stroke="${T.ruleSolid}"/>
<text x="${x}" y="${ty + (up ? 12 : 0)}" text-anchor="middle" font-size="11" fill="${T.muted}" font-family="${MONO}">${esc(e.date ?? '')}</text>
<text x="${x}" y="${ty + (up ? -2 : 26)}" text-anchor="middle" font-size="12" fill="${T.ink}">${esc(e.label)}</text>
${e.desc ? `<text x="${x}" y="${ty + (up ? 26 : 42)}" text-anchor="middle" font-size="10" fill="${T.soft}">${esc(e.desc)}</text>` : ''}`;
  }).join('');
  return { w, h, body: `<line x1="${M - 20}" y1="${y}" x2="${w - M + 20}" y2="${y}" stroke="${T.ruleSolid}" stroke-width="2"/>` + body, title: spec.title };
}

function swimlane(spec) {
  const lanes = spec.lanes, LH = 76, LW = 130, SW = 110, M = 20;
  const maxSteps = Math.max(...lanes.map((l) => l.steps.length));
  const w = M * 2 + 90 + maxSteps * (SW + 34);
  const h = M * 2 + lanes.length * LH;
  const body = arrowMarker()
    + lanes.map((lane, li) => {
      const y = M + li * LH;
      return `<rect x="${M}" y="${y}" width="${w - 2 * M}" height="${LH - 10}" fill="${li % 2 ? T.paper2 : '#ffffff'}" stroke="${T.rule}"/>
<text x="${M + 10}" y="${y + LH / 2 - 6}" font-size="12" fill="${T.ink}">${esc(lane.name)}</text>`
        + lane.steps.map((s, si) => {
          const x = M + 110 + si * (SW + 34);
          return box(x, y + 8, SW, LH - 26, s.label, { focal: !!s.focal, sub: s.sub });
        }).join('')
        + lane.steps.slice(0, -1).map((_, si) => {
          const x1 = M + 110 + si * (SW + 34) + SW, x2 = x1 + 34;
          return `<line x1="${x1}" y1="${y + 8 + (LH - 26) / 2}" x2="${x2}" y2="${y + 8 + (LH - 26) / 2}" stroke="${T.muted}" stroke-width="1.5" marker-end="url(#arr)"/>`;
        }).join('');
    }).join('');
  return { w, h, body, title: spec.title };
}

function pyramid(spec) {
  const levels = spec.levels;
  const w = 760, LH = 66, M = 40;
  const h = M * 2 + levels.length * LH;
  const body = levels.map((lv, i) => {
    const topW = 120 + i * ((w - 2 * M - 120) / Math.max(1, levels.length - 1 || 1)) * 0.92;
    const botW = 120 + ((i + 1) / levels.length) * (w - 2 * M - 120) * 0.92;
    const y = M + i * LH;
    const focal = i === (spec.focalLevel ?? levels.length - 1);
    const cx = w / 2;
    return `<polygon points="${cx - topW / 2},${y} ${cx + topW / 2},${y} ${cx + botW / 2},${y + LH - 8} ${cx - botW / 2},${y + LH - 8}" fill="${focal ? T.accentTint : '#ffffff'}" stroke="${focal ? T.accent : T.ruleSolid}"/>
<text x="${cx}" y="${y + LH / 2 - 4}" text-anchor="middle" font-size="13" fill="${T.ink}">${esc(lv.label)}</text>
${lv.desc ? `<text x="${cx}" y="${y + LH / 2 + 13}" text-anchor="middle" font-size="10" fill="${T.soft}">${esc(lv.desc)}</text>` : ''}`;
  }).join('');
  return { w, h, body, title: spec.title };
}

function venn(spec) {
  const sets = spec.sets.slice(0, 3);
  const w = 720, h = 440, R = 130;
  const centers = sets.length === 2 ? [[w / 2 - 70, h / 2], [w / 2 + 70, h / 2]]
    : [[w / 2 - 66, h / 2 - 44], [w / 2 + 66, h / 2 - 44], [w / 2, h / 2 + 66]];
  const body = sets.map((s, i) => `
<circle cx="${centers[i][0]}" cy="${centers[i][1]}" r="${R}" fill="${T.ink}" fill-opacity="0.045" stroke="${T.muted}" stroke-width="1.5"/>
<text x="${centers[i][0]}" y="${centers[i][1] - R - 12}" text-anchor="middle" font-size="13" fill="${T.ink}">${esc(s.label)}</text>`).join('')
    + (spec.centerLabel ? `<text x="${w / 2}" y="${h / 2 + (sets.length === 3 ? 4 : 4)}" text-anchor="middle" font-size="12" fill="${T.accent}" font-weight="600">${esc(spec.centerLabel)}</text>` : '');
  return { w, h, body, title: spec.title };
}

function quadrant(spec) {
  const w = 760, h = 560, M = 90;
  const cw = w - 2 * M, ch = h - 2 * M;
  const { x = {}, y = {} } = spec.axes ?? {};
  const body = `
<rect x="${M}" y="${M}" width="${cw}" height="${ch}" fill="#ffffff" stroke="${T.ruleSolid}"/>
<line x1="${M + cw / 2}" y1="${M}" x2="${M + cw / 2}" y2="${M + ch}" stroke="${T.rule}"/>
<line x1="${M}" y1="${M + ch / 2}" x2="${M + cw}" y2="${M + ch / 2}" stroke="${T.rule}"/>
<text x="${M + cw / 4}" y="${M - 14}" text-anchor="middle" font-size="12" fill="${T.soft}">${esc(spec.labels?.tl ?? '')}</text>
<text x="${M + 3 * cw / 4}" y="${M - 14}" text-anchor="middle" font-size="12" fill="${T.soft}">${esc(spec.labels?.tr ?? '')}</text>
<text x="${M + cw / 4}" y="${M + ch + 22}" text-anchor="middle" font-size="12" fill="${T.soft}">${esc(spec.labels?.bl ?? '')}</text>
<text x="${M + 3 * cw / 4}" y="${M + ch + 22}" text-anchor="middle" font-size="12" fill="${T.soft}">${esc(spec.labels?.br ?? '')}</text>
<text x="${M + cw / 2}" y="${h - 28}" text-anchor="middle" font-size="12" fill="${T.muted}">${esc(x.hi ?? '')} →</text>
<text x="26" y="${M + ch / 2}" text-anchor="middle" font-size="12" fill="${T.muted}" transform="rotate(-90 26 ${M + ch / 2})">${esc(y.hi ?? '')} →</text>`
    + (spec.points ?? []).map((p) => {
      const px = M + (p.x / 100) * cw, py = M + ch - (p.y / 100) * ch;
      return `<circle cx="${px}" cy="${py}" r="${p.focal ? 8 : 6}" fill="${p.focal ? T.accent : T.ink}"/>
<text x="${px + 12}" y="${py + 4}" font-size="12" fill="${T.ink}">${esc(p.label)}</text>`;
    }).join('');
  return { w, h, body, title: spec.title };
}

// ---------- catalog ----------
const CATALOG = {
  flowchart: flowchart, sequence: sequence, state: state, timeline: timeline,
  swimlane: swimlane, pyramid: pyramid, venn: venn, quadrant: quadrant,
};
const CATALOG_ONLY = ['architecture', 'bar', 'data-flow', 'db-schema', 'dependency', 'deployment',
  'dp-integration', 'dp-security-matrix', 'er', 'fishbone', 'gantt', 'high-level', 'it-state',
  'journey', 'kanban', 'layers', 'line', 'loop', 'medallion', 'nested', 'org-chart', 'polar',
  'process', 'radar', 'sankey', 'scatter', 'story-map', 'tree', 'treemap', 'uml-class',
  'wardley', 'waterfall'];

const SPEC_HELP = {
  flowchart: '{ title, nodes:[{id,label,focal?,sub?}], edges:[{from,to,label?,link?}] }',
  sequence: '{ title, actors:[..], messages:[{from,to,label,kind?:call|return|async}] }',
  state: '{ title, states:[{id,label,start?}], transitions:[{from,to,label?}] } ("__start" pseudo-state allowed)',
  timeline: '{ title, events:[{label,date?,desc?,focal?}] }',
  swimlane: '{ title, lanes:[{name, steps:[{label,focal?,sub?}]}] }',
  pyramid: '{ title, levels:[{label,desc?}], focalLevel? }',
  venn: '{ title, sets:[{label}] (2-3), centerLabel? }',
  quadrant: '{ title, axes:{x:{hi},y:{hi}}, labels:{tl,tr,bl,br}, points:[{label,x:0-100,y:0-100,focal?}] }',
};

export function render(type, spec) {
  if (CATALOG[type]) {
    const { w, h, body, title } = CATALOG[type](spec);
    return svgDoc(w, h, body, title || type);
  }
  if (CATALOG_ONLY.includes(type)) {
    throw new Error(`RENDERER_NOT_IMPLEMENTED: '${type}' is catalog-only. Follow references/type-${type}.md for its layout grammar (or export via Mermaid/draw.io). Scripted types: ${Object.keys(CATALOG).join(', ')}.`);
  }
  throw new Error(`UNKNOWN_TYPE: '${type}'. Use --list-types.`);
}

// --- CLI ---
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const get = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
  if (args.includes('--list-types')) {
    console.log(JSON.stringify({ scripted: Object.keys(CATALOG), catalogOnly: CATALOG_ONLY, total: Object.keys(CATALOG).length + CATALOG_ONLY.length }, null, 2));
    process.exit(0);
  }
  const type = get('--type');
  const specPath = get('--spec');
  const out = get('--out');
  if (args.includes('--help') || !type) {
    console.log('usage: render-diagram.mjs --type <t> [--spec spec.json|-] --out out.svg | --list-types');
    for (const [t, h] of Object.entries(SPEC_HELP)) console.log(`  ${t}: ${h}`);
    process.exit(type ? 0 : 2);
  }
  try {
    const spec = JSON.parse(specPath && specPath !== '-' ? fs.readFileSync(specPath, 'utf8') : fs.readFileSync(0, 'utf8'));
    const svg = render(type, spec);
    if (!out) process.stdout.write(svg);
    else { fs.writeFileSync(out, svg); console.log(`WROTE ${out} (${svg.length} bytes, type=${type})`); }
  } catch (e) {
    console.error('RENDER_ERROR:', e.message);
    process.exit(1);
  }
}

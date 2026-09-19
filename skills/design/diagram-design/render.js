/**
 * JEXI OS — Phase 17 Scope H — DIAGRAM DESIGN / RENDERER.
 *
 * renderDiagram(typeName, spec, opts) → a standalone, self-contained SVG
 * document: brand background, kicker + serif title block, the type's scene,
 * and a legend footer — JEXI Market tokens throughout. Deterministic:
 * same type + spec + theme → byte-identical output.
 *
 * Editorial contract (style-guide of cathrynlavery/diagram-design, MIT,
 * mapped onto JEXI tokens via brand.js): whitespace is a feature, color is
 * functional (accent 1–2 focal uses), no shadows, radii ≤ 6 on boxes,
 * content never touches the frame (40px margins, 60px legend strip).
 */

import { loadBrand } from './brand.js';
import { Svg, esc, round4 } from './kit.js';
import { TYPES, getType } from './types/index.js';

export const MARGIN = 40;
export const LEGEND = 60;

/**
 * @param {string} typeName   one of listTypes() names
 * @param {object} spec       the diagram spec (validated against the type's inputSchema)
 * @param {object} [opts]     { brand, width, height }
 * @returns {{svg: string, type: object, width: number, height: number}}
 */
export function renderDiagram(typeName, spec = {}, opts = {}) {
  const t = getType(typeName); // throws E_UNKNOWN_TYPE with the valid list
  const b = opts.brand || loadBrand();
  const width = round4(opts.width || spec.width || t.defaults?.width || 960);
  const height = round4(opts.height || spec.height || t.defaults?.height || 560);

  // Schema validation — honest errors before any pixels are imagined.
  validate(t, spec);

  const svg = new Svg();
  svg.rect(0, 0, width, height, { fill: 'paper' });

  // Title block (kicker mono register + serif display title + subtitle).
  let top = MARGIN;
  const title = spec.title ?? t.label;
  svg.text(MARGIN, top + 8, `Diagram Design · ${t.label}`, { size: 8, mono: true, fill: 'soft', spacing: '0.14em', upper: true });
  svg.raw(`<text x="${MARGIN}" y="${top + 34}" font-family="display" font-size="24" font-weight="600" fill="${b.ink}">${esc(title)}</text>`);
  if (spec.subtitle) svg.text(MARGIN, top + 54, spec.subtitle, { size: 11.5, fill: 'muted' });
  svg.line(MARGIN, top + 66, width - MARGIN, top + 66, { stroke: 'line', sw: 0.8 });
  top += 92;

  // The type draws its scene.
  const ctx = {
    b, svg,
    x: MARGIN, y: top,
    w: width - MARGIN * 2,
    h: height - top - LEGEND,
  };
  t.render(spec, ctx);

  // Legend strip: hairline + type register left, brand register right.
  const fy = height - LEGEND + 24;
  svg.line(MARGIN, fy, width - MARGIN, fy, { stroke: 'line', sw: 0.8 });
  svg.text(MARGIN, fy + 18, t.label, { size: 8, mono: true, fill: 'soft', spacing: '0.1em', upper: true });
  if (spec.note) svg.text(MARGIN + 140, fy + 18, String(spec.note).slice(0, 110), { size: 8.5, mono: true, fill: 'soft' });
  svg.text(width - MARGIN, fy + 18, 'JEXI · diagram-design', { size: 8, mono: true, fill: 'soft', anchor: 'end', spacing: '0.1em' });

  const doc = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${esc(title)}">`,
    svg.toString(b),
    '</svg>',
    '',
  ].join('\n');
  return { svg: doc, type: t, width, height };
}

/** Minimal required-field validation with honest error codes. */
export function validate(t, spec) {
  const s = t.inputSchema || {};
  for (const key of s.required || []) {
    if (spec[key] == null) {
      const e = new Error(`${t.name}: missing required spec field "${key}"`);
      e.code = 'E_SPEC_MISSING';
      throw e;
    }
  }
  const props = s.properties || {};
  for (const [key, def] of Object.entries(props)) {
    if (spec[key] == null) continue;
    const want = def.type;
    const got = Array.isArray(spec[key]) ? 'array' : typeof spec[key];
    if (want === 'array' && !Array.isArray(spec[key])) {
      const e = new Error(`${t.name}: spec.${key} must be an array`); e.code = 'E_SPEC_TYPE'; throw e;
    }
    if (want && want !== 'array' && got !== want) {
      const e = new Error(`${t.name}: spec.${key} must be ${want} (got ${got})`); e.code = 'E_SPEC_TYPE'; throw e;
    }
  }
}

/** All registered types (sorted by name). */
export function listTypes() {
  return TYPES.map((t) => ({ name: t.name, label: t.label, description: t.description, whenToUse: t.whenToUse, upstream: t.upstream })).sort((a, b2) => a.name.localeCompare(b2.name));
}

export { getType, loadBrand };
export default { renderDiagram, listTypes, getType, loadBrand, validate };

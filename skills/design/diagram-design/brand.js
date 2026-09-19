/**
 * JEXI OS — Phase 17 Scope H — DIAGRAM DESIGN / BRAND.
 *
 * Reads src/styles/jexi-theme.css (JEXI Market design tokens v2) and emits
 * the palette every diagram uses, so diagrams look like they belong to JEXI.
 *
 * Role mapping (diagram-design role → theme token):
 *   paper   → --jcx-bg      (#0c0b09)   page background
 *   paper2  → --jcx-panel   (#15130f)   secondary fill
 *   panel2  → --jcx-panel-2 (#1c1915)   tertiary fill
 *   panel3  → --jcx-panel-3 (#241f19)
 *   ink     → --jcx-ink     (#f3eee6)   primary text / primary stroke
 *   muted   → --jcx-ink-2   (#a99f90)   secondary text, default arrows
 *   soft    → --jcx-ink-3   (#7a7163)   sublabels
 *   rule    → --jcx-line    (#282318)   hairlines
 *   accent  → --jcx-ember   (#ff7a3d)   focal, 1–2 max per diagram
 *   coral   → --jcx-coral   (#ff6b5e)
 *   peach   → --jcx-peach   (#ffb88c)   external/link arrows (warm theme —
 *                                        the theme has NO blue token; the
 *                                        upstream `link` role is filled by
 *                                        peach. Documented, deterministic.)
 *   sand    → --jcx-sand    (#e8d9c4)
 *   gold    → --jcx-gold    (#e5b567)   warning / tier emphasis
 *   up      → --jcx-up      (#4cc38a)   positive
 *   down    → --jcx-down    (#ff5d5d)   negative
 *
 * Fallback palette below is byte-identical to the shipped theme so a missing
 * CSS file changes nothing (determinism never depends on the environment).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FALLBACK = Object.freeze({
  bg: '#0c0b09', panel: '#15130f', panel2: '#1c1915', panel3: '#241f19',
  line: '#282318', lineSoft: '#201c15',
  ink: '#f3eee6', ink2: '#a99f90', ink3: '#7a7163',
  ember: '#ff7a3d', coral: '#ff6b5e', peach: '#ffb88c', sand: '#e8d9c4', gold: '#e5b567',
  up: '#4cc38a', down: '#ff5d5d',
  radius: 14,
  fonts: Object.freeze({
    sans: "'Inter',-apple-system,'Segoe UI',system-ui,Roboto,sans-serif",
    mono: "'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace",
    display: "'Fraunces',Georgia,'Times New Roman',serif",
  }),
});

/** Extract `--jcx-xxx:#hex;` declarations from the theme CSS (deterministic). */
export function extractTokens(css) {
  const out = {};
  for (const m of String(css || '').matchAll(/--jcx-([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
    out[m[1]] = m[2].toLowerCase();
  }
  return out;
}

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const THEME = path.join(REPO, 'src', 'styles', 'jexi-theme.css');

/**
 * Load the brand palette.
 * @param {object} [o]  { themePath } override for tests
 * @returns {object} brand (frozen)
 */
export function loadBrand(o = {}) {
  let tokens = {};
  let source = 'fallback (theme file not read)';
  try {
    const css = fs.readFileSync(o.themePath || THEME, 'utf8');
    tokens = extractTokens(css);
    if (tokens.bg && tokens.ember) source = o.themePath || THEME;
  } catch { /* keep fallback */ }
  const t = { ...FALLBACK, ...tokens };
  const brand = {
    bg: t.bg, panel: t.panel, panel2: t.panel2, panel3: t.panel3,
    line: t.line, lineSoft: t.lineSoft,
    ink: t.ink, muted: t.ink2, soft: t.ink3,
    accent: t.ember, coral: t.coral, peach: t.peach, sand: t.sand, gold: t.gold,
    up: t.up, down: t.down,
    link: t.peach, // upstream `link` role — warm substitution, documented
    radius: FALLBACK.radius,
    fonts: { ...FALLBACK.fonts },
    source,
    accentTint: 'rgba(255,122,61,0.10)',
    upTint: 'rgba(76,195,138,0.14)',
    downTint: 'rgba(255,93,93,0.14)',
    goldTint: 'rgba(229,181,103,0.16)',
  };
  // Semantic role aliases used by types/* and kit.js's toString rewrite table
  // (upstream role names → jexi-theme.css variables):
  brand.paper = brand.bg;      // page background  (--jcx-bg)
  brand.paper2 = brand.panel;  // secondary fill   (--jcx-panel)
  brand.ink2 = brand.muted;    // secondary text   (--jcx-ink-2)
  brand.ink3 = brand.soft;     // tertiary text    (--jcx-ink-3)
  brand.rule = brand.line;     // hairlines        (--jcx-line)
  return Object.freeze(brand);
}

export default { loadBrand, extractTokens, FALLBACK };

// Generates all JEXI OS app-icon assets procedurally — zero dependencies.
// Emits the files @capacitor/assets expects in ./assets:
//   icon.png, icon-only.png, icon-foreground.png,
//   icon-background.png, icon-background-dark.png, splash.png
//   (plus assets/icon-512.png for store listings)
//
// Design (Phase 6 F-build): the JEXI Market logo — inlined verbatim from
// jexi/web brand.tsx JexiMark. Warm charcoal gradient tile (#1a1712 →
// #12100c), J monogram stroked with the ember→coral brand gradient
// (#FF7A3D → #FF6B5E), peach chart line (#FFB88C), coral dot (#FF6B5E).
// Splash: same mark centered on the brand background #0c0b09.
//
// Usage:
//   node scripts/make-icon.js          → ./assets/* (for @capacitor/assets)
//   node scripts/make-icon.js --res    → also overwrite android res mipmaps
//                                        + every res/**/splash.png (same dims)

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RES = join(ROOT, 'android', 'app', 'src', 'main', 'res');

/* ---------------- PNG encoder ---------------- */
const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  // B164 — was `c >>> 8` here (typo): produced a garbage CRC table, so EVERY
  // PNG this script ever wrote (icons + splash) carried corrupt CRCs. Strict
  // decoders (phone launchers, PIL) reject or degrade such files — the
  // launcher icon silently fell back to the stock template. Must be >>> 1.
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(size * stride);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0;
    rgba.copy(raw, y * stride + 1, y * size * 4, (y * size + size) * 4);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
function encodePngWH(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = w * 4 + 1;
  const raw = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0;
    rgba.copy(raw, y * stride + 1, y * w * 4, (y * w + w) * 4);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------------- color / geometry helpers ---------------- */
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const lerp = (a, b, t) => a + (b - a) * t;
const mixc = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
function segDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const L2 = dx * dx + dy * dy || 1e-9;
  let t = ((px - x1) * dx + (py - y1) * dy) / L2;
  t = clamp01(t);
  const qx = x1 + t * dx, qy = y1 + t * dy;
  return Math.hypot(px - qx, py - qy);
}
// quadratic bezier distance via dense sampling (art is tiny; 96 samples is plenty)
function quadDist(px, py, x1, y1, cx, cy, x2, y2) {
  let best = Infinity;
  for (let i = 0; i <= 96; i++) {
    const t = i / 96, u = 1 - t;
    const qx = u * u * x1 + 2 * u * t * cx + t * t * x2;
    const qy = u * u * y1 + 2 * u * t * cy + t * t * y2;
    const d = Math.hypot(px - qx, py - qy);
    if (d < best) best = d;
  }
  return best;
}
function rrSDF(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - hw + r, qy = Math.abs(py - cy) - hh + r;
  const ax = Math.max(qx, 0), ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
}

/* ---------------- brand constants (JexiMark, verbatim) ---------------- */
const TILE_A = hex('#1a1712'), TILE_B = hex('#12100c');
const J_A = hex('#FF7A3D'), J_B = hex('#FF6B5E');
const PEACH = hex('#FFB88C'), CORAL = hex('#FF6B5E');
const EDGE = hex('#3a3226');
const SPLASH_BG = hex('#0c0b09');

// J monogram: M18 14 L18 38 Q18 50 29 50 Q37 50 40.5 44 (w 5.5, gradient)
const J_SEGS = [
  { type: 'line', pts: [18, 14, 18, 38] },
  { type: 'quad', pts: [18, 38, 18, 50, 29, 50] },
  { type: 'quad', pts: [29, 50, 37, 50, 40.5, 44] },
];
const J_W = 5.5, J_GA = [18, 14], J_GB = [41, 50];
// chart: M34 40 L41 33 L46 37 L54 24 (w 3.4 peach)
const C_SEGS = [[34, 40, 41, 33], [41, 33, 46, 37], [46, 37, 54, 24]];
const C_W = 3.4;
const DOT = [54, 24, 3.4];

/* Render the mark in a 64-unit art box, output S×S RGBA.
   mode: 'tile' (full logo) | 'art' (strokes only, transparent bg)
   round: mask to a circle */
function renderMark(S, mode = 'tile', round = false, SS = 4) {
  const W = S * SS;
  const k = W / 64;
  const img = Buffer.alloc(W * W * 4);
  const rr = 15;
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const px = (x + 0.5) / k, py = (y + 0.5) / k;
      let col, a;
      if (mode === 'tile') {
        // tile gradient fill (diagonal, matches the SVG linearGradient)
        const tg = clamp01((px + py) / 128);
        col = mixc(TILE_A, TILE_B, tg);
        // anti-aliased rounded-rect coverage
        const d = rrSDF(px, py, 32, 32, 32, 32, rr);
        a = smooth(0.5, -0.5, d);
        // 1px inner border #3a3226 (the SVG's stroke rect, inset 0.5)
        const bd = Math.abs(d + 0.5);
        const ba = smooth(1.1, 0.4, bd) * a;
        col = mixc(col, EDGE, ba * 0.9);
      } else {
        col = [0, 0, 0]; a = 0;
      }
      // J monogram with brand gradient along (18,14)→(41,50)
      let jd = Infinity;
      for (const s of J_SEGS) {
        const d = s.type === 'line'
          ? segDist(px, py, ...s.pts)
          : quadDist(px, py, ...s.pts);
        if (d < jd) jd = d;
      }
      const ja = smooth(J_W / 2 + 0.4, J_W / 2 - 0.4, jd);
      if (ja > 0) {
        const vx = J_GB[0] - J_GA[0], vy = J_GB[1] - J_GA[1];
        const t = clamp01(((px - J_GA[0]) * vx + (py - J_GA[1]) * vy) / (vx * vx + vy * vy));
        col = mixc(col, mixc(J_A, J_B, t), ja);
        a = Math.max(a, ja);
      }
      // peach chart line
      let cd = Infinity;
      for (const s of C_SEGS) cd = Math.min(cd, segDist(px, py, ...s));
      const ca = smooth(C_W / 2 + 0.4, C_W / 2 - 0.4, cd);
      if (ca > 0) { col = mixc(col, PEACH, ca); a = Math.max(a, ca); }
      // coral dot
      const dd = Math.hypot(px - DOT[0], py - DOT[1]);
      const da = smooth(DOT[2] + 0.4, DOT[2] - 0.4, dd);
      if (da > 0) { col = mixc(col, CORAL, da); a = Math.max(a, da); }
      if (round) {
        const cd2 = Math.hypot(px - 32, py - 32);
        a *= smooth(32 + 0.5, 32 - 0.5, cd2);
      }
      const o = (y * W + x) * 4;
      img[o] = Math.round(clamp01(col[0] / 255) * 255);
      img[o + 1] = Math.round(clamp01(col[1] / 255) * 255);
      img[o + 2] = Math.round(clamp01(col[2] / 255) * 255);
      img[o + 3] = Math.round(clamp01(a) * 255);
    }
  }
  // box downsample SS×
  const out = Buffer.alloc(S * S * 4);
  const inv = SS * SS;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let r = 0, g = 0, b = 0, al = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const o = ((y * SS + sy) * W + (x * SS + sx)) * 4;
          const pa = img[o + 3] / 255;
          r += img[o] * pa; g += img[o + 1] * pa; b += img[o + 2] * pa;
          al += img[o + 3];
        }
      }
      const o = (y * S + x) * 4;
      const fa = al / inv;
      const cov = fa / 255 || 1e-9;
      out[o] = Math.round(clamp01(r / inv / (cov * 255)) * 255);
      out[o + 1] = Math.round(clamp01(g / inv / (cov * 255)) * 255);
      out[o + 2] = Math.round(clamp01(b / inv / (cov * 255)) * 255);
      out[o + 3] = Math.round(fa);
    }
  }
  return out;
}

/* Splash W×H: brand background + centered mark (30% of min dimension). */
function renderSplash(w, h, markPct = 0.3) {
  const canvas = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    canvas[i * 4] = SPLASH_BG[0];
    canvas[i * 4 + 1] = SPLASH_BG[1];
    canvas[i * 4 + 2] = SPLASH_BG[2];
    canvas[i * 4 + 3] = 255;
  }
  const S = Math.max(64, Math.round(Math.min(w, h) * markPct));
  const mark = renderMark(S, 'tile', false, S > 400 ? 2 : 4);
  const ox = Math.round((w - S) / 2), oy = Math.round((h - S) / 2);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const o = (y * S + x) * 4;
      const a = mark[o + 3] / 255;
      if (a <= 0) continue;
      const t = ((oy + y) * w + (ox + x)) * 4;
      canvas[t] = Math.round(mark[o] * a + canvas[t] * (1 - a));
      canvas[t + 1] = Math.round(mark[o + 1] * a + canvas[t + 1] * (1 - a));
      canvas[t + 2] = Math.round(mark[o + 2] * a + canvas[t + 2] * (1 - a));
    }
  }
  return { canvas, w, h };
}

/* ---------------- emitters ---------------- */
function writePng(path, buf, w, h) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, h ? encodePngWH(w, h, buf) : encodePng(w, buf));
  console.log('wrote', path, h ? `${w}x${h}` : `${w}x${w}`);
}

function emitAssets() {
  const A = join(ROOT, 'assets');
  writePng(join(A, 'icon.png'), renderMark(1024, 'tile'), 1024);
  writePng(join(A, 'icon-only.png'), renderMark(1024, 'tile'), 1024);
  writePng(join(A, 'icon-foreground.png'), renderMark(1024, 'art'), 1024);
  // background layers: the tile gradient full-bleed (no art, no rounding)
  const bg = Buffer.alloc(1024 * 1024 * 4);
  for (let y = 0; y < 1024; y++) {
    for (let x = 0; x < 1024; x++) {
      const tg = clamp01((x + y) / 2048);
      const c = mixc(TILE_A, TILE_B, tg);
      const o = (y * 1024 + x) * 4;
      bg[o] = c[0]; bg[o + 1] = c[1]; bg[o + 2] = c[2]; bg[o + 3] = 255;
    }
  }
  writePng(join(A, 'icon-background.png'), bg, 1024);
  writePng(join(A, 'icon-background-dark.png'), bg, 1024);
  const sp = renderSplash(2732, 2732);
  writePng(join(A, 'splash.png'), sp.canvas, sp.w, sp.h);
  writePng(join(A, 'icon-512.png'), renderMark(512, 'tile'), 512);
}

/* Overwrite the android res launcher icons + every existing splash.png
   (same file paths, same pixel dimensions as the current resources). */
function emitRes() {
  const DENS = { 'mipmap-ldpi': 36, 'mipmap-mdpi': 48, 'mipmap-hdpi': 72, 'mipmap-xhdpi': 96, 'mipmap-xxhdpi': 144, 'mipmap-xxxhdpi': 192 };
  for (const [dir, S] of Object.entries(DENS)) {
    const d = join(RES, dir);
    if (!statSafe(d)) continue;
    writePng(join(d, 'ic_launcher.png'), renderMark(S, 'tile'), S);
    writePng(join(d, 'ic_launcher_round.png'), renderMark(S, 'tile', true), S);
    writePng(join(d, 'ic_launcher_foreground.png'), renderMark(S, 'art'), S);
    // background bitmap: full-bleed tile gradient
    const bg = Buffer.alloc(S * S * 4);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const tg = clamp01((x + y) / (2 * S));
        const c = mixc(TILE_A, TILE_B, tg);
        const o = (y * S + x) * 4;
        bg[o] = c[0]; bg[o + 1] = c[1]; bg[o + 2] = c[2]; bg[o + 3] = 255;
      }
    }
    writePng(join(d, 'ic_launcher_background.png'), bg, S);
  }
  // splash: overwrite every res/**/splash.png. Dimensions are FIXED (the
  // standard @capacitor/assets set) so the script is deterministic and
  // idempotent even if files on disk are already overwritten.
  const SPLASH_SIZES = {
    'drawable': [320, 480],
    'drawable-night': [320, 240],
    'drawable-land-hdpi': [800, 480],
    'drawable-land-ldpi': [320, 240],
    'drawable-land-mdpi': [480, 320],
    'drawable-land-xhdpi': [1280, 720],
    'drawable-land-xxhdpi': [1600, 960],
    'drawable-land-xxxhdpi': [1920, 1280],
    'drawable-land-night-hdpi': [800, 480],
    'drawable-land-night-ldpi': [320, 240],
    'drawable-land-night-mdpi': [480, 320],
    'drawable-land-night-xhdpi': [1280, 720],
    'drawable-land-night-xxhdpi': [1600, 960],
    'drawable-land-night-xxxhdpi': [1920, 1280],
    'drawable-port-ldpi': [240, 320],
    'drawable-port-mdpi': [320, 480],
    'drawable-port-hdpi': [480, 800],
    'drawable-port-xhdpi': [720, 1280],
    'drawable-port-xxhdpi': [960, 1600],
    'drawable-port-xxxhdpi': [1280, 1920],
    'drawable-port-night-ldpi': [240, 320],
    'drawable-port-night-mdpi': [320, 480],
    'drawable-port-night-hdpi': [480, 800],
    'drawable-port-night-xhdpi': [720, 1280],
    'drawable-port-night-xxhdpi': [960, 1600],
    'drawable-port-night-xxxhdpi': [1280, 1920],
  };
  let n = 0;
  for (const [dir, [w, h]] of Object.entries(SPLASH_SIZES)) {
    const p = join(RES, dir, 'splash.png');
    const sp = renderSplash(w, h);
    writePng(p, sp.canvas, sp.w, sp.h);
    n++;
  }
  console.log('splash files updated:', n);
}

function statSafe(p) { try { return statSync(p).isDirectory(); } catch { return false; } }
function walk(dir, cb) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, cb);
    else cb(p);
  }
}
function readPngSize(p) {
  try {
    const b = readFileSync(p);
    if (b.length < 24) return null;
    return [b.readUInt32BE(16), b.readUInt32BE(20)];
  } catch { return null; }
}

const mode = process.argv[2] || '';
emitAssets();
if (mode === '--res') emitRes();
console.log('done — JEXI Market logo (JexiMark) brand assets');

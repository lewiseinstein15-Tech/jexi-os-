// Generates all JEXI OS app-icon assets procedurally — zero dependencies.
// Emits the files @capacitor/assets expects in ./assets:
//   icon.png, icon-only.png, icon-foreground.png,
//   icon-background.png, icon-background-dark.png, splash.png
// Design: neon cyan→violet "AI eye" ring with orbiting nodes and a bright core.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

/* ---------------- PNG encoder ---------------- */
const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
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
    rgba.copy(raw, y * stride + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------------- color / math helpers ---------------- */
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const lerp = (a, b, t) => a + (b - a) * t;
const mix = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

const BG_TOP = hex('#10101f');
const BG_BOT = hex('#04040a');
const RING_STOPS = [hex('#22d3ee'), hex('#a78bfa'), hex('#f472b6')]; // cyan → violet → pink
const CORE = hex('#e6fbff');
const WHITE = hex('#ffffff');

function rrDist(x, y, C, half, r) {
  const qx = Math.abs(x - C) - (half - r);
  const qy = Math.abs(y - C) - (half - r);
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
}

/* Paint the design at design-space (x, y) into outR/G/B. */
const RING_R = 330;
const RING_HALF = 30;
const NODES = 12;
function paintDesign(x, y) {
  const g = clamp01((x + y) / (2 * 1024));
  let r = lerp(BG_BOT[0], BG_TOP[0], 1 - g);
  let gn = lerp(BG_BOT[1], BG_TOP[1], 1 - g);
  let b = lerp(BG_BOT[2], BG_TOP[2], 1 - g);

  const dx = x - 512;
  const dy = y - 512;
  const dist = Math.hypot(dx, dy);
  const ang = Math.atan2(dy, dx);
  const t = ((ang / (2 * Math.PI)) + 1) % 1;

  const seg = t * (RING_STOPS.length - 1);
  const i = Math.min(Math.floor(seg), RING_STOPS.length - 2);
  const ringCol = mix(RING_STOPS[i], RING_STOPS[i + 1], seg - i);

  const ringBody =
    smooth(RING_R + RING_HALF + 2, RING_R + RING_HALF, dist) *
    (1 - smooth(RING_R - RING_HALF - 2, RING_R - RING_HALF, dist));
  const glow =
    0.5 *
    smooth(RING_R + RING_HALF + 80, RING_R + RING_HALF + 6, dist) *
    (1 - smooth(RING_R - RING_HALF - 46, RING_R - RING_HALF - 2, dist));
  const ring = clamp01(ringBody + glow);
  r = lerp(r, ringCol[0], ring);
  gn = lerp(gn, ringCol[1], ring);
  b = lerp(b, ringCol[2], ring);

  for (let k = 0; k < NODES; k++) {
    const na = (k / NODES) * Math.PI * 2 + 0.35;
    const nx = 512 + Math.cos(na) * RING_R;
    const ny = 512 + Math.sin(na) * RING_R;
    const nd = Math.hypot(x - nx, y - ny);
    const nglow = 0.85 * smooth(48, 12, nd);
    r = lerp(r, WHITE[0], nglow);
    gn = lerp(gn, WHITE[1], nglow);
    b = lerp(b, WHITE[2], nglow);
  }

  const coreGlow = 0.5 * smooth(200, 60, dist);
  const coreBody = 0.95 * smooth(82, 18, dist);
  const core = clamp01(coreGlow + coreBody);
  r = lerp(r, CORE[0], core);
  gn = lerp(gn, CORE[1], core);
  b = lerp(b, CORE[2], core);

  return [r, gn, b];
}

/*
 * Render an output image.
 *  size      — output edge length
 *  scale     — design zoom (1 = full frame, <1 = zoomed out / centered smaller)
 *  bg        — background color [r,g,b] (solid). If null, transparent outside the design.
 *  corners   — if true, apply a rounded-square alpha mask (legacy icons only)
 */
function render(size, { scale = 1, bg = null, corners = false }) {
  const buf = Buffer.alloc(size * size * 4);
  const C = size / 2;
  const radius = Math.round(200 * (size / 1024));
  const half = size / 2 - 1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // map output pixel → design space
      const dx = (x - C) / scale + 512;
      const dy = (y - C) / scale + 512;
      let r, gn, b;
      if (dx >= 0 && dx < 1024 && dy >= 0 && dy < 1024) {
        [r, gn, b] = paintDesign(dx, dy);
      } else {
        r = bg ? bg[0] : 0;
        gn = bg ? bg[1] : 0;
        b = bg ? bg[2] : 0;
      }
      let a = 255;
      if (corners) a = clamp01(0.5 - rrDist(x + 0.5, y + 0.5, C, half, radius)) * 255;
      const idx = (y * size + x) * 4;
      buf[idx] = Math.round(r);
      buf[idx + 1] = Math.round(gn);
      buf[idx + 2] = Math.round(b);
      buf[idx + 3] = Math.round(a);
    }
  }
  return buf;
}

mkdirSync('assets', { recursive: true });

// Master icon (1024, rounded corners) — also the legacy launcher source.
writeFileSync('assets/icon.png', encodePng(1024, render(1024, { corners: true })));
// @capacitor/assets defaults:
writeFileSync('assets/icon-only.png', encodePng(1024, render(1024, { corners: true })));
// Adaptive foreground: design zoomed to ~62%, transparent background
writeFileSync('assets/icon-foreground.png', encodePng(1024, render(1024, { scale: 0.62, bg: null })));
// Adaptive backgrounds (solid)
writeFileSync('assets/icon-background.png', encodePng(1024, render(1024, { scale: 1, bg: hex('#10101f') })));
writeFileSync('assets/icon-background-dark.png', encodePng(1024, render(1024, { scale: 1, bg: hex('#04040a') })));
// Splash: 2732x2732, icon at ~30% centered on dark
writeFileSync('assets/splash.png', encodePng(2732, render(2732, { scale: 0.3, bg: hex('#050508') })));

console.log('assets generated: icon.png, icon-only.png, icon-foreground.png, icon-background.png, icon-background-dark.png, splash.png');

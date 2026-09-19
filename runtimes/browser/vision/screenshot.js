/**
 * JEXI OS — Phase 17 Scope C — VISION / SCREENSHOT.
 *
 * captureScreenshot(session, {clip}) — real CDP `Page.captureScreenshot` over
 * the runtime's raw CDP session (no Playwright needed).
 *
 * A dependency-free PNG codec (zlib is built into Node) so crops and pixel
 * checks work without native image libraries:
 *   encodePng(rgba, w, h)  — RGBA → PNG (filter 0 rows, deflate)
 *   decodePng(buf)         — PNG → {width, height, rgba} (8-bit, truecolor/alpha,
 *                            filters 0–4, non-interlaced — the space CDP output
 *                            and this runtime's fixtures live in)
 *   cropPng(buf, rect)     — decode → slice → re-encode; rect in IMAGE pixels
 *
 * Image pixels vs viewport pixels: CDP captures at devicePixelRatio; every rect
 * the caller holds in CSS pixels goes through coordinate-map.js scaleBox first.
 */

import zlib from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** RGBA pixels → PNG buffer (no filter, deflate). */
export function encodePng(rgba, width, height) {
  if (rgba.length !== width * height * 4) {
    throw new Error(`encodePng: expected ${width * height * 4} bytes of RGBA, got ${rgba.length}`);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  // 10..12: compression 0, filter 0, interlace 0 (already zero)
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** PNG buffer → {width, height, rgba}. Supports 8-bit RGB/RGBA/grayscale, filters 0–4, non-interlaced. */
export function decodePng(buf) {
  if (!buf || buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('decodePng: not a PNG buffer');
  }
  let off = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (bitDepth !== 8) throw new Error(`decodePng: unsupported bit depth ${bitDepth} (8 only)`);
  if (interlace !== 0) throw new Error('decodePng: interlaced PNG not supported');
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : null;
  if (!channels) throw new Error(`decodePng: unsupported color type ${colorType}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const px = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const row = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? row[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      row[i] = filter === 0 ? row[i] : filter === 1 ? (row[i] + a) & 0xff : filter === 2 ? (row[i] + b) & 0xff : filter === 3 ? (row[i] + ((a + b) >> 1)) & 0xff : (row[i] + paeth(a, b, c)) & 0xff;
    }
    prev = row;
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (channels === 4) { row.copy(px, o, x * 4, x * 4 + 4); }
      else if (channels === 3) { px[o] = row[x * 3]; px[o + 1] = row[x * 3 + 1]; px[o + 2] = row[x * 3 + 2]; px[o + 3] = 255; }
      else { px[o] = px[o + 1] = px[o + 2] = row[x]; px[o + 3] = 255; }
    }
  }
  return { width, height, rgba: px };
}

/** Crop a PNG to {x, y, w, h} (IMAGE pixels). Returns a new PNG buffer. */
export function cropPng(pngBuf, { x, y, w, h }) {
  const img = decodePng(pngBuf);
  x = Math.max(0, Math.min(x | 0, img.width - 1));
  y = Math.max(0, Math.min(y | 0, img.height - 1));
  w = Math.max(1, Math.min(w | 0, img.width - x));
  h = Math.max(1, Math.min(h | 0, img.height - y));
  const out = Buffer.alloc(w * h * 4);
  for (let row = 0; row < h; row++) {
    const src = (y + row) * img.width * 4 + x * 4;
    img.rgba.copy(out, row * w * 4, src, src + w * 4);
  }
  return encodePng(out, w, h);
}

/**
 * Real screenshot capture through the runtime's CDP session.
 * @param {import('../cdp.js').CdpSession} session
 * @param {{clip?: {x:number,y:number,width:number,height:number,scale?:number}, format?: 'png'|'jpeg', quality?: number, fromSurface?: boolean}} [o]
 * @returns {Promise<{buffer: Buffer, base64: string, clip: object|null, ms: number, bytes: number}>}
 */
export async function captureScreenshot(session, o = {}) {
  const started = Date.now();
  await session.enable('Page').catch(() => { /* optional */ });
  const params = { format: o.format || 'png', fromSurface: o.fromSurface !== false };
  if (o.quality !== undefined) params.quality = o.quality;
  if (o.clip) {
    params.clip = { ...o.clip, scale: o.clip.scale ?? 1 };
  }
  const r = await session.send('Page.captureScreenshot', params);
  const base64 = r.data;
  const buffer = Buffer.from(base64, 'base64');
  return { buffer, base64, clip: o.clip || null, ms: Date.now() - started, bytes: buffer.length };
}

/** Dimensions of a PNG buffer without decoding pixels. */
export function pngInfo(buf) {
  if (!buf || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('pngInfo: not a PNG buffer');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

export default { captureScreenshot, encodePng, decodePng, cropPng, pngInfo };

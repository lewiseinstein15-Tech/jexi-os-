/**
 * JEXI OS — Phase 9 Scope H — Screenshot diff (visual regression).
 *
 * Zone: verification/visual/** (Phase 9 Scope H).
 *
 * Pure-Node PNG codec (node:zlib + hand-rolled CRC32/unfiltering) — no
 * external imaging dependency exists in this sandbox, and "real PNG
 * buffers, real diffs" forbids faking. Supported input: 8-bit
 * non-interlaced PNG, color types 0 (gray), 2 (RGB), 4 (gray+alpha),
 * 6 (RGBA) — everything Chromium/Playwright and encodePng() emit.
 * Adam7 interlace and bit depths other than 8 are REFUSED loudly
 * (E_UNSUPPORTED_PNG), never mis-decoded.
 *
 * DIFF SEMANTICS
 *   - a pixel differs iff max(|dR|,|dG|,|dB|) > pixelTolerance (alpha is
 *     ignored — screenshots are opaque)
 *   - pctDiff = differing pixels / total * 100  (percent, 0..100)
 *   - changed = pctDiff > threshold (percent; default 0 → ANY real pixel
 *     difference counts as changed)
 *   - diffImage: differing pixels highlighted pure red, matching pixels
 *     dimmed to 30% luminance grayscale — the classic regression view
 */

import { inflateSync, deflateSync } from 'node:zlib';

export class DiffError extends Error {
  /**
   * @param {string} code   stable machine-readable reason
   * @param {string} message human-readable detail
   */
  constructor(code, message) {
    super(message);
    this.name = 'DiffError';
    this.code = code;
  }
}

/* ------------------------------------------------------------------ */
/* CRC32 (PNG chunk checksums)                                         */
/* ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/* ------------------------------------------------------------------ */
/* encode — RGBA pixels → PNG Buffer (color type 6, 8-bit, filter 0)   */
/* ------------------------------------------------------------------ */

/**
 * Encode raw RGBA pixels as a PNG.
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array|Buffer} rgba length = width*height*4
 * @returns {Buffer}
 */
export function encodePng(width, height, rgba) {
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new DiffError('E_INVALID_ARG', `encodePng: invalid dimensions ${width}x${height}`);
  }
  const expected = width * height * 4;
  if (!rgba || rgba.length !== expected) {
    throw new DiffError('E_INVALID_ARG', `encodePng: rgba must be exactly ${expected} bytes for ${width}x${height} (got ${rgba ? rgba.length : 'null'})`);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace: none
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride)
      .copy(raw, y * (stride + 1) + 1);
  }
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------ */
/* decode — PNG Buffer → { width, height, rgba }                       */
/* ------------------------------------------------------------------ */

const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * Decode a PNG into raw RGBA.
 * @param {Buffer|Uint8Array} buffer
 * @returns {{ width: number, height: number, rgba: Buffer }}
 */
export function decodePng(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new DiffError('E_INVALID_PNG', 'decodePng: not a PNG (bad signature)');
  }
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let sawIhdr = false;
  const idat = [];
  let off = 8;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (off + 12 + len > buf.length) {
      throw new DiffError('E_INVALID_PNG', `decodePng: truncated ${type} chunk`);
    }
    if (type === 'IHDR') {
      if (len !== 13) throw new DiffError('E_INVALID_PNG', 'decodePng: IHDR must be 13 bytes');
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
      sawIhdr = true;
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    off += 12 + len;
  }
  if (!sawIhdr) throw new DiffError('E_INVALID_PNG', 'decodePng: missing IHDR');
  if (width <= 0 || height <= 0) throw new DiffError('E_INVALID_PNG', `decodePng: bad dimensions ${width}x${height}`);
  if (bitDepth !== 8) {
    throw new DiffError('E_UNSUPPORTED_PNG', `decodePng: bit depth ${bitDepth} unsupported (only 8)`);
  }
  if (!(colorType in CHANNELS)) {
    throw new DiffError('E_UNSUPPORTED_PNG', `decodePng: color type ${colorType} unsupported (palette PNGs not supported)`);
  }
  if (interlace !== 0) {
    throw new DiffError('E_UNSUPPORTED_PNG', 'decodePng: Adam7 interlaced PNGs unsupported');
  }
  const channels = CHANNELS[colorType];
  const stride = width * channels;
  const compressed = Buffer.concat(idat);
  let raw;
  try {
    raw = inflateSync(compressed);
  } catch (e) {
    throw new DiffError('E_INVALID_PNG', `decodePng: IDAT inflate failed: ${e.message}`);
  }
  if (raw.length !== (stride + 1) * height) {
    throw new DiffError('E_INVALID_PNG', `decodePng: decompressed length ${raw.length} ≠ expected ${(stride + 1) * height}`);
  }
  // Unfilter all scanlines in place.
  const un = new Uint8Array(stride * height);
  let pos = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[pos];
    pos += 1;
    const row = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const v = raw[pos + x];
      const left = x >= channels ? un[row + x - channels] : 0;
      const up = y > 0 ? un[row - stride + x] : 0;
      const ul = y > 0 && x >= channels ? un[row - stride + x - channels] : 0;
      let rec;
      if (filter === 0) rec = v;
      else if (filter === 1) rec = v + left;
      else if (filter === 2) rec = v + up;
      else if (filter === 3) rec = v + ((left + up) >> 1);
      else if (filter === 4) rec = v + paeth(left, up, ul);
      else throw new DiffError('E_INVALID_PNG', `decodePng: unknown scanline filter ${filter}`);
      un[row + x] = rec & 0xff;
    }
    pos += stride;
  }
  // Expand to RGBA.
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const s = i * channels;
    const d = i * 4;
    if (colorType === 6) {
      rgba[d] = un[s]; rgba[d + 1] = un[s + 1]; rgba[d + 2] = un[s + 2]; rgba[d + 3] = un[s + 3];
    } else if (colorType === 2) {
      rgba[d] = un[s]; rgba[d + 1] = un[s + 1]; rgba[d + 2] = un[s + 2]; rgba[d + 3] = 255;
    } else if (colorType === 4) {
      rgba[d] = un[s]; rgba[d + 1] = un[s]; rgba[d + 2] = un[s]; rgba[d + 3] = un[s + 1];
    } else { // 0: grayscale
      rgba[d] = un[s]; rgba[d + 1] = un[s]; rgba[d + 2] = un[s]; rgba[d + 3] = 255;
    }
  }
  return { width, height, rgba };
}

/* ------------------------------------------------------------------ */
/* compare — visual regression                                         */
/* ------------------------------------------------------------------ */

/**
 * Compare two PNG buffers.
 * @param {Buffer|Uint8Array} before
 * @param {Buffer|Uint8Array} after
 * @param {{ threshold?: number, pixelTolerance?: number }} [opts]
 *   threshold       percent of pixels (0..100) above which the images
 *                   count as changed (default 0 → any difference counts)
 *   pixelTolerance  per-channel max delta (0..255) below which a pixel
 *                   still counts as equal (default 0 → exact compare)
 * @returns {{ changed: boolean, pixelsDiff: number, totalPixels: number,
 *             pctDiff: number, threshold: number, pixelTolerance: number,
 *             width: number, height: number, diffImage: Buffer }}
 */
export function compare(before, after, { threshold = 0, pixelTolerance = 0 } = {}) {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
    throw new DiffError('E_INVALID_ARG', `compare: threshold must be 0..100 percent (got ${threshold})`);
  }
  if (!Number.isInteger(pixelTolerance) || pixelTolerance < 0 || pixelTolerance > 255) {
    throw new DiffError('E_INVALID_ARG', `compare: pixelTolerance must be an integer 0..255 (got ${pixelTolerance})`);
  }
  const a = decodePng(before);
  const b = decodePng(after);
  if (a.width !== b.width || a.height !== b.height) {
    throw new DiffError(
      'E_DIMENSION_MISMATCH',
      `compare: dimensions differ — before ${a.width}x${a.height}, after ${b.width}x${b.height}`,
    );
  }
  const total = a.width * a.height;
  const diff = Buffer.alloc(total * 4);
  let pixelsDiff = 0;
  for (let i = 0; i < total; i += 1) {
    const s = i * 4;
    const dR = Math.abs(a.rgba[s] - b.rgba[s]);
    const dG = Math.abs(a.rgba[s + 1] - b.rgba[s + 1]);
    const dB = Math.abs(a.rgba[s + 2] - b.rgba[s + 2]);
    const maxDelta = Math.max(dR, dG, dB);
    if (maxDelta > pixelTolerance) {
      pixelsDiff += 1;
      diff[s] = 255; diff[s + 1] = 0; diff[s + 2] = 0; diff[s + 3] = 255; // red highlight
    } else {
      const lum = Math.round(0.2126 * a.rgba[s] + 0.7152 * a.rgba[s + 1] + 0.0722 * a.rgba[s + 2]) * 0.3;
      const g = Math.min(255, Math.round(lum));
      diff[s] = g; diff[s + 1] = g; diff[s + 2] = g; diff[s + 3] = 255; // dimmed grayscale
    }
  }
  const pctDiff = (pixelsDiff / total) * 100;
  return {
    changed: pctDiff > threshold,
    pixelsDiff,
    totalPixels: total,
    pctDiff,
    threshold,
    pixelTolerance,
    width: a.width,
    height: a.height,
    diffImage: encodePng(a.width, a.height, diff),
  };
}

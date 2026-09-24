// computer/screenshot/optimize.js
// Phase 29 Scope D — screenshot optimize: resize + DPI + format.
// TARS GuiAgentPlugin aggressively shrinks screenshots before the VLM
// (subtract pixels, resize, compress) to cut payload size and token cost.
// This module owns that step, deterministically, with zero new
// dependencies: the PNG codec below is hand-rolled on node:zlib.
//
// Declared contract (Scope D):
//   optimize(image, { maxWidth, maxHeight, format })
//     -> { image, width, height, bytes,            (contract fields)
//          format, resized,                        (declared echo)
//          sourceWidth, sourceHeight,              (physical input dims)
//          scaleX, scaleY }                        (physical-per-model factors)
//
//   - image: PNG bytes (Buffer/Uint8Array). Missing image -> E_INVALID_ARGUMENT;
//     present-but-undecodable bytes -> E_INVALID_IMAGE.
//   - Determinism: for a given (image, params) the output is byte-identical
//     across calls. Resize is nearest-neighbor (center sample); encoding is
//     PNG baseline, 8-bit RGBA, filter type 0 per scanline, zlib deflate at
//     fixed level 6. No timestamps, no randomness, no parallel variance.
//   - Never upscales: scale = min(1, maxWidth/w, maxHeight/h). When scale
//     is 1 (no constraint binds) the ORIGINAL bytes are returned unchanged
//     (pass-through) — real bytes in, real bytes out.
//   - Physical vs logical (DPI declaration): the capture is the PHYSICAL
//     pixel space; the optimized output is the LOGICAL (model-facing) space.
//     Both are reported together: sourceWidth/sourceHeight (physical) and
//     width/height (logical). scaleX = sourceWidth/width and
//     scaleY = sourceHeight/height are EXACTLY the factors of the Scope A
//     normalization formula
//         x' = clamp(round(x * W_screen / W_model), 0, W_screen)
//     with W_screen = sourceWidth (physical) and W_model = width (logical).
//     A model point in optimized space maps back with the identical formula.
//   - Format param: accepted per contract, PNG baseline is the only
//     implemented format ('png', the default). Any other value is REFUSED
//     with E_INVALID_ARGUMENT — the pipeline never silently upgrades to a
//     lossy format.
//   - This module NEVER fabricates image data. It only transforms bytes it
//     is given; producing pixels is the capture source's job.
//
// Codec domain (declared): 8-bit, non-interlaced PNG, color types
// 0 (gray) / 2 (RGB) / 3 (palette) / 4 (gray+alpha) / 6 (RGBA). Chunk CRCs
// are verified. tRNS is ignored (palette transparency is not applied).
// Everything outside the domain is refused with E_INVALID_IMAGE — refused,
// never guessed at.
//
// Errors (ComputerError codes):
//   E_INVALID_IMAGE     — bytes present but not a decodable in-domain PNG
//                         (bad signature, CRC mismatch, unsupported bit
//                         depth / color type / interlace, truncated chunk,
//                         missing IHDR/IDAT/IEND, bad zlib stream, raw size
//                         mismatch, invalid filter byte, palette index
//                         out of range)
//   E_INVALID_ARGUMENT  — image missing, params not an object, unknown
//                         param key, maxWidth/maxHeight not positive
//                         integers, format !== 'png'

import { inflateSync, deflateSync } from 'node:zlib';
import { ComputerError } from '../errors.js';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const COLOR_CHANNELS = Object.freeze({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 });
const MAX_DIMENSION = 65535; // PNG u16 sanity bound
const MAX_PIXELS = 2 ** 28;  // allocation guard (268M pixels)
const DEFLATE_LEVEL = 6;     // fixed for determinism

const OPTIMIZE_PARAM_KEYS = Object.freeze(['maxWidth', 'maxHeight', 'format']);

// ---------------------------------------------------------------------------
// CRC32 (PNG chunk checksums) — table-driven, deterministic.
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf, start = 0, end = buf.length) {
  let c = 0xffffffff;
  for (let i = start; i < end; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function failImage(message) {
  throw new ComputerError('E_INVALID_IMAGE', message, {});
}

// ---------------------------------------------------------------------------
// decodePNG — PNG bytes -> { width, height, pixels (RGBA Uint8Array),
// colorType, bitDepth }. Throws E_INVALID_IMAGE outside the declared domain.
// ---------------------------------------------------------------------------
export function decodePNG(input) {
  if (!Buffer.isBuffer(input) && !(input instanceof Uint8Array)) {
    failImage('image data must be PNG bytes (Buffer/Uint8Array)');
  }
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    failImage('not a PNG image (bad signature)');
  }

  let off = 8;
  let ihdr = null;
  let plte = null;
  const idat = [];
  let sawIEND = false;
  while (off + 8 <= buf.length && !sawIEND) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    const dataStart = off + 8;
    const dataEnd = dataStart + len;
    if (dataEnd + 4 > buf.length) failImage(`truncated PNG chunk ${type}`);
    const expectedCrc = buf.readUInt32BE(dataEnd);
    if (crc32(buf, off + 4, dataEnd) !== expectedCrc) {
      failImage(`PNG chunk CRC mismatch (${type})`);
    }
    const data = buf.subarray(dataStart, dataEnd);
    if (type === 'IHDR') {
      if (ihdr) failImage('duplicate IHDR chunk');
      if (data.length !== 13) failImage('IHDR chunk must be 13 bytes');
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        compression: data[10],
        filterMethod: data[11],
        interlace: data[12],
      };
    } else if (type === 'PLTE') {
      plte = Buffer.from(data);
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(data));
    } else if (type === 'IEND') {
      sawIEND = true;
    } // ancillary chunks are ignored
    off = dataEnd + 4;
  }
  if (!ihdr) failImage('missing IHDR chunk');
  if (!sawIEND) failImage('missing IEND chunk');

  const { width, height, bitDepth, colorType, compression, filterMethod, interlace } = ihdr;
  if (
    width < 1 || height < 1 ||
    width > MAX_DIMENSION || height > MAX_DIMENSION ||
    width * height > MAX_PIXELS
  ) {
    failImage(`unsupported PNG dimensions ${width}x${height}`);
  }
  if (bitDepth !== 8) failImage(`unsupported PNG bit depth ${bitDepth} (8-bit only)`);
  if (!(colorType in COLOR_CHANNELS)) failImage(`unsupported PNG color type ${colorType}`);
  if (compression !== 0) failImage(`unsupported PNG compression method ${compression}`);
  if (filterMethod !== 0) failImage(`unsupported PNG filter method ${filterMethod}`);
  if (interlace !== 0) failImage('interlaced PNG not supported');
  const channels = COLOR_CHANNELS[colorType];
  if (colorType === 3 && (!plte || plte.length < 3 || plte.length > 768 || plte.length % 3 !== 0)) {
    failImage('palette PNG missing or invalid PLTE chunk');
  }
  if (idat.length === 0) failImage('missing IDAT chunk');

  let raw;
  try {
    raw = inflateSync(Buffer.concat(idat));
  } catch (err) {
    failImage(`invalid PNG zlib stream (${err && err.message ? err.message : String(err)})`);
  }
  const bytesPerRow = width * channels;
  const scanline = 1 + bytesPerRow;
  if (raw.length !== scanline * height) {
    failImage(`PNG raw data size mismatch (got ${raw.length}, expected ${scanline * height})`);
  }

  // Un-filter scanlines (filters 0..4; unit = channels bytes for 8-bit depth).
  const plane = Buffer.alloc(bytesPerRow * height);
  for (let y = 0; y < height; y += 1) {
    const ft = raw[y * scanline];
    if (ft > 4) failImage(`invalid PNG filter type ${ft} on scanline ${y}`);
    const rowOff = y * bytesPerRow;
    for (let x = 0; x < bytesPerRow; x += 1) {
      const a = x >= channels ? plane[rowOff + x - channels] : 0;
      const b = y > 0 ? plane[rowOff - bytesPerRow + x] : 0;
      const c = x >= channels && y > 0 ? plane[rowOff - bytesPerRow + x - channels] : 0;
      const v = raw[y * scanline + 1 + x];
      let val;
      if (ft === 0) val = v;
      else if (ft === 1) val = v + a;
      else if (ft === 2) val = v + b;
      else if (ft === 3) val = v + ((a + b) >> 1);
      else {
        const p = (a + b - c) | 0;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        val = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      plane[rowOff + x] = val & 0xff;
    }
  }

  // Normalize to RGBA.
  const pixels = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const o = i * channels;
    const q = i * 4;
    if (colorType === 6) {
      pixels[q] = plane[o];
      pixels[q + 1] = plane[o + 1];
      pixels[q + 2] = plane[o + 2];
      pixels[q + 3] = plane[o + 3];
    } else if (colorType === 2) {
      pixels[q] = plane[o];
      pixels[q + 1] = plane[o + 1];
      pixels[q + 2] = plane[o + 2];
      pixels[q + 3] = 255;
    } else if (colorType === 0) {
      const g = plane[o];
      pixels[q] = g;
      pixels[q + 1] = g;
      pixels[q + 2] = g;
      pixels[q + 3] = 255;
    } else if (colorType === 4) {
      const g = plane[o];
      pixels[q] = g;
      pixels[q + 1] = g;
      pixels[q + 2] = g;
      pixels[q + 3] = plane[o + 1];
    } else {
      const idx = plane[o] * 3;
      if (idx + 2 >= plte.length) failImage(`palette index out of range at pixel ${i}`);
      pixels[q] = plte[idx];
      pixels[q + 1] = plte[idx + 1];
      pixels[q + 2] = plte[idx + 2];
      pixels[q + 3] = 255;
    }
  }
  return { width, height, pixels, colorType, bitDepth };
}

// ---------------------------------------------------------------------------
// encodePNG — RGBA pixels -> baseline PNG bytes (deterministic).
// 8-bit RGBA, filter type 0 per scanline, deflate at fixed level.
// ---------------------------------------------------------------------------
function pngChunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePNG(pixels, width, height) {
  if (
    !(pixels instanceof Uint8Array) ||
    !Number.isInteger(width) || !Number.isInteger(height) ||
    width < 1 || height < 1 ||
    pixels.length !== width * height * 4
  ) {
    throw new ComputerError('E_INVALID_ARGUMENT', 'encodePNG: pixels must be RGBA with length width*height*4', {});
  }
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter type: None
    raw.set(pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // no interlace
  const idat = deflateSync(raw, { level: DEFLATE_LEVEL });
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// resizeNearest — nearest-neighbor, center sample (deterministic).
// ---------------------------------------------------------------------------
function resizeNearest(pixels, w, h, outW, outH) {
  const dst = new Uint8Array(outW * outH * 4);
  for (let y = 0; y < outH; y += 1) {
    const sy = Math.min(h - 1, Math.floor(((y + 0.5) * h) / outH));
    for (let x = 0; x < outW; x += 1) {
      const sx = Math.min(w - 1, Math.floor(((x + 0.5) * w) / outW));
      const s = (sy * w + sx) * 4;
      const d = (y * outW + x) * 4;
      dst[d] = pixels[s];
      dst[d + 1] = pixels[s + 1];
      dst[d + 2] = pixels[s + 2];
      dst[d + 3] = pixels[s + 3];
    }
  }
  return dst;
}

// ---------------------------------------------------------------------------
// optimize — the declared Scope D entry point.
// ---------------------------------------------------------------------------
export function optimize(image, params = {}) {
  if (image === undefined || image === null) {
    throw new ComputerError('E_INVALID_ARGUMENT', 'optimize: image is required (PNG bytes)', {});
  }
  if (params === null || typeof params !== 'object' || Array.isArray(params)) {
    throw new ComputerError('E_INVALID_ARGUMENT', 'optimize: params must be an object', {});
  }
  for (const key of Object.keys(params)) {
    if (!OPTIMIZE_PARAM_KEYS.includes(key)) {
      throw new ComputerError(
        'E_INVALID_ARGUMENT',
        `optimize: unknown param "${key}" (allowed: ${OPTIMIZE_PARAM_KEYS.join(', ')})`,
        { got: key }
      );
    }
  }
  const format = params.format === undefined ? 'png' : params.format;
  if (format !== 'png') {
    throw new ComputerError(
      'E_INVALID_ARGUMENT',
      `optimize: unsupported format ${JSON.stringify(format)} — PNG baseline is the only implemented format; lossy formats are never applied silently`,
      { got: format }
    );
  }
  for (const key of ['maxWidth', 'maxHeight']) {
    const v = params[key];
    if (v === undefined) continue;
    if (!Number.isInteger(v) || v < 1) {
      throw new ComputerError(
        'E_INVALID_ARGUMENT',
        `optimize: ${key} must be a positive integer, got ${JSON.stringify(v)}`,
        { got: v }
      );
    }
  }

  const decoded = decodePNG(image);
  const { width: w, height: h, pixels } = decoded;
  let scale = 1; // never upscale
  if (params.maxWidth !== undefined) scale = Math.min(scale, params.maxWidth / w);
  if (params.maxHeight !== undefined) scale = Math.min(scale, params.maxHeight / h);
  const outW = Math.max(1, Math.round(w * scale));
  const outH = Math.max(1, Math.round(h * scale));
  const resized = outW !== w || outH !== h;
  const outImage = resized
    ? encodePNG(resizeNearest(pixels, w, h, outW, outH), outW, outH)
    : Buffer.isBuffer(image) ? image : Buffer.from(image); // pass-through, byte-preserving

  return {
    image: outImage,
    width: outW,
    height: outH,
    bytes: outImage.length,
    format: 'png',
    resized,
    sourceWidth: w,
    sourceHeight: h,
    scaleX: w / outW,
    scaleY: h / outH,
  };
}

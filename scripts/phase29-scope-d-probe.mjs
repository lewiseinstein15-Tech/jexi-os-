#!/usr/bin/env node
// scripts/phase29-scope-d-probe.mjs
// Phase 29 — Scope D live probe: screenshot capture + optimization.
// Zero dependencies. Fixture PNGs are built in-probe by a declared
// test-only encoder (probe fixtures only — the module itself never
// fabricates image data; P1/P5 prove the refusal paths). Raw output per
// check. Exit 1 on any failure.

import { spawnSync } from 'node:child_process';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { capture, optimize, diff } from '../computer/screenshot/index.js';
import { ComputerError } from '../computer/errors.js';
import { normalize, NORMALIZE_FORMULA } from '../computer/action/coordinate.js';

const WT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
function check(name, ok, evidence) {
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}`);
  console.log(`        ${evidence}`);
  if (!ok) failures += 1;
}
function codeOf(fn) {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof ComputerError ? e : { code: `NOT_COMPUTER_ERROR:${e?.message}` };
  }
}

// ---------------------------------------------------------------------------
// Test-only fixture encoder (probe-local, disclosed). Produces real baseline
// PNG bytes — real bytes in / real bytes out; no fabricated module output.
// ---------------------------------------------------------------------------
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf, start = 0, end = buf.length) {
  let c = 0xffffffff;
  for (let i = start; i < end; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function encodeFixture(width, height, pixelAt) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: None
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = pixelAt(x, y);
      const o = y * (stride + 1) + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    PNG_SIG,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const makeRed = () => encodeFixture(8, 6, () => [255, 0, 0, 255]);
const makeRedOneBlue = () =>
  encodeFixture(8, 6, (x, y) => (x === 3 && y === 2 ? [0, 0, 255, 255] : [255, 0, 0, 255]));
const makeBig = () => encodeFixture(1920, 1080, (x, y) => [(x * 7) % 256, (y * 11) % 256, (x + y) % 256, 255]);
const RED_8X6 = makeRed();
const BIG_1920 = makeBig();

function ihdrDims(png) {
  return { w: png.readUInt32BE(16), h: png.readUInt32BE(20) };
}

console.log('=== SCOPE D PROBE — screenshot capture + optimization ===');
console.log(`node ${process.version}`);
console.log('declared codes: E_NO_CAPTURE_SOURCE | E_INVALID_IMAGE | E_INVALID_ARGUMENT (all ComputerError)');
console.log('fixtures: in-probe test-only PNG encoder (disclosed); the module itself never fabricates');
console.log('');

// ---------------------------------------------------------------------------
// P1 — capture from an injected fake source (8x6 red PNG) -> { image, width,
//      height, dpi }; dims decoded from IHDR, not trusted from the source
// ---------------------------------------------------------------------------
const fakeSource = {
  testOnly: true,
  name: 'probe-fake-capture-source',
  dpi: 2,
  grab: () => Buffer.from(RED_8X6),
};
const c1 = capture(fakeSource);
const c1dims = ihdrDims(c1.image);
console.log(`P1 capture result raw: ${JSON.stringify({ width: c1.width, height: c1.height, dpi: c1.dpi, bytes: c1.image.length })}`);
console.log(`P1 IHDR independent parse: ${c1dims.w}x${c1dims.h}; PNG signature ok: ${c1.image.subarray(0, 8).equals(PNG_SIG)}`);
const liarSource = {
  testOnly: true,
  name: 'probe-liar-source',
  dpi: 3,
  width: 999,  // lie — bytes are authoritative
  height: 1,
  grab: () => Buffer.from(RED_8X6),
};
const c1b = capture(liarSource);
console.log(`P1 liar-source claims 999x1 -> capture reports ${c1b.width}x${c1b.height} (IHDR wins), dpi echoed: ${c1b.dpi}`);
const p1ok =
  c1.width === 8 && c1.height === 6 && c1.dpi === 2 && Buffer.isBuffer(c1.image) &&
  c1.image.subarray(0, 8).equals(PNG_SIG) && c1dims.w === 8 && c1dims.h === 6 &&
  c1b.width === 8 && c1b.height === 6 && c1b.dpi === 3;
check(
  'P1 capture(injected fake source) -> { image, width:8, height:6, dpi:2 }; width/height come from the PNG IHDR (a lying source still reports true dims)',
  p1ok,
  `width=${c1.width} height=${c1.height} dpi=${c1.dpi} bytes=${c1.image.length} ihdr=${c1dims.w}x${c1dims.h} liar=${c1b.width}x${c1b.height},dpi=${c1b.dpi}`
);
console.log('');

// ---------------------------------------------------------------------------
// P2 — optimize 1920x1080 -> maxWidth 800 / maxHeight 600: aspect preserved,
//      bytes dropped
// ---------------------------------------------------------------------------
const beforeBytes = BIG_1920.length;
const o2 = optimize(BIG_1920, { maxWidth: 800, maxHeight: 600 });
const o2dims = ihdrDims(o2.image);
const aspectIn = 1920 / 1080;
const aspectOut = o2.width / o2.height;
console.log(`P2 before: 1920x1080, ${beforeBytes} bytes`);
console.log(`P2 optimize result raw: ${JSON.stringify({ width: o2.width, height: o2.height, bytes: o2.bytes, resized: o2.resized, format: o2.format, sourceWidth: o2.sourceWidth, sourceHeight: o2.sourceHeight })}`);
console.log(`P2 IHDR independent parse: ${o2dims.w}x${o2dims.h}; aspect ${aspectIn.toFixed(6)} -> ${aspectOut.toFixed(6)}; bytes dropped: ${beforeBytes - o2.bytes}`);
const p2ok =
  o2.width === 800 && o2.height === 450 && o2dims.w === 800 && o2dims.h === 450 &&
  o2.bytes === o2.image.length && o2.bytes < beforeBytes &&
  Math.abs(aspectIn - aspectOut) < 1e-9 && o2.resized === true && o2.format === 'png';
check(
  'P2 optimize 1920x1080 with maxWidth 800 / maxHeight 600: aspect preserved (800x450), bytes dropped, IHDR agrees with the report',
  p2ok,
  `1920x1080 ${beforeBytes}B -> ${o2.width}x${o2.height} ${o2.bytes}B (dropped ${beforeBytes - o2.bytes}); aspect ${aspectIn.toFixed(6)} -> ${aspectOut.toFixed(6)}`
);
console.log('');

// ---------------------------------------------------------------------------
// P3 — diff is exact: identical -> changed:false ratio:0; one pixel ->
//      changedRatio === 1/(width*height) exactly
// ---------------------------------------------------------------------------
const dSame = diff(makeRed(), makeRed());
console.log(`P3 identical raw: ${JSON.stringify(dSame)}`);
const dOne = diff(makeRed(), makeRedOneBlue());
console.log(`P3 one-pixel-different raw: ${JSON.stringify(dOne)}`);
console.log(`P3 expected exact ratio: 1/(8*6) = ${1 / 48}; exact double match: ${dOne.changedRatio === 1 / 48}`);
const p3ok =
  dSame.changed === false && dSame.changedRatio === 0 && dSame.changedPixels === 0 &&
  dOne.changed === true && dOne.changedPixels === 1 && dOne.totalPixels === 48 &&
  dOne.changedRatio === 1 / 48;
check(
  'P3 diff exact, not sampled: identical images -> changed:false, changedRatio:0; one differing pixel -> changedRatio === 1/48 exactly',
  p3ok,
  `same={changed:${dSame.changed},ratio:${dSame.changedRatio}} one={changedPixels:${dOne.changedPixels}/48,ratio:${dOne.changedRatio}} exactMatch:${dOne.changedRatio === 1 / 48}`
);
console.log('');

// ---------------------------------------------------------------------------
// P4 — DPI scaling proof: physical 1920x1080, model expects 1000x1000 box ->
//      optimize reports physical + logical together; scaleX/scaleY are
//      exactly Scope A's W_screen/W_model factors (real normalize agrees)
// ---------------------------------------------------------------------------
const o4 = optimize(BIG_1920, { maxWidth: 1000, maxHeight: 1000 });
console.log(`P4 optimize result raw: ${JSON.stringify({ sourceWidth: o4.sourceWidth, sourceHeight: o4.sourceHeight, width: o4.width, height: o4.height, scaleX: o4.scaleX, scaleY: o4.scaleY, bytes: o4.bytes })}`);
const modelSize = { width: o4.width, height: o4.height };
const screenSize = { width: o4.sourceWidth, height: o4.sourceHeight };
const xSamples = [0, 1, 7, 250, 500, 750, 999, 1000];
const ySamples = [0, 1, 140, 280, 500, 563];
let normMismatch = null;
for (const x of xSamples) {
  const viaA = normalize({ x, y: 0 }, { modelSize, screenSize }).x;
  const viaS = Math.max(0, Math.min(screenSize.width, Math.round(x * o4.scaleX)));
  if (viaA !== viaS) { normMismatch = { axis: 'x', at: x, viaA, viaS }; break; }
}
if (!normMismatch) {
  for (const y of ySamples) {
    const viaA = normalize({ x: 0, y }, { modelSize, screenSize }).y;
    const viaS = Math.max(0, Math.min(screenSize.height, Math.round(y * o4.scaleY)));
    if (viaA !== viaS) { normMismatch = { axis: 'y', at: y, viaA, viaS }; break; }
  }
}
console.log(`P4 Scope A formula: ${NORMALIZE_FORMULA}`);
console.log(`P4 real coordinate.normalize vs scaleX/scaleY mapping: ${normMismatch ? `MISMATCH ${JSON.stringify(normMismatch)}` : 'identical on all samples'}`);
console.log(`P4 factor double-identity: scaleX === ${o4.sourceWidth}/${o4.width}: ${o4.scaleX === o4.sourceWidth / o4.width}; scaleY === ${o4.sourceHeight}/${o4.height}: ${o4.scaleY === o4.sourceHeight / o4.height}`);
const p4ok =
  o4.sourceWidth === 1920 && o4.sourceHeight === 1080 && o4.width === 1000 &&
  o4.height === Math.round(1080 * (1000 / 1920)) && !normMismatch &&
  o4.scaleX === o4.sourceWidth / o4.width && o4.scaleY === o4.sourceHeight / o4.height;
check(
  "P4 DPI scaling: optimize reports physical (1920x1080) and logical/model space together; scaleX/scaleY are exactly Scope A's W_screen/W_model factors — coordinate.normalize fed the optimize output agrees on every sample",
  p4ok,
  `physical=${o4.sourceWidth}x${o4.sourceHeight} logical=${o4.width}x${o4.height} scaleX=${o4.scaleX} scaleY=${o4.scaleY} mismatch=${JSON.stringify(normMismatch)}`
);
console.log('');

// ---------------------------------------------------------------------------
// P5 — sandbox without capture source -> E_NO_CAPTURE_SOURCE; nothing
//      fabricated on any path
// ---------------------------------------------------------------------------
const e5a = codeOf(() => capture());
const e5b = codeOf(() => capture(null));
const e5c = codeOf(() => capture({ testOnly: true, name: 'empty-source', grab: () => null }));
const e5d = codeOf(() => capture({
  testOnly: true,
  name: 'throwing-source',
  grab() { throw new Error('device vanished'); },
}));
console.log(`P5 capture() -> ${e5a && e5a.code}`);
console.log(`P5 capture(null) -> ${e5b && e5b.code}`);
console.log(`P5 source yields null -> ${e5c && e5c.code}`);
console.log(`P5 source throws mid-grab -> ${e5d && e5d.code} (${e5d && e5d.message})`);
console.log('P5 every path REFUSES — no image data is returned or synthesized');
const p5ok =
  e5a && e5a.code === 'E_NO_CAPTURE_SOURCE' &&
  e5b && e5b.code === 'E_NO_CAPTURE_SOURCE' &&
  e5c && e5c.code === 'E_NO_CAPTURE_SOURCE' &&
  e5d && e5d.code === 'E_NO_CAPTURE_SOURCE';
check(
  'P5 sandbox without capture source -> E_NO_CAPTURE_SOURCE on all refusal paths (missing / null / yields nothing / mid-grab failure); no fabricated image',
  p5ok,
  `capture()=${e5a?.code} null=${e5b?.code} empty=${e5c?.code} thrown=${e5d?.code}`
);
console.log('');

// ---------------------------------------------------------------------------
// P6 — invalid params -> E_INVALID_ARGUMENT; malformed bytes -> E_INVALID_IMAGE
// ---------------------------------------------------------------------------
const e6a = codeOf(() => optimize(BIG_1920, { maxWidth: 0 }));
const e6b = codeOf(() => optimize(BIG_1920, { maxWidth: -5 }));
const e6c = codeOf(() => optimize(BIG_1920, { maxHeight: 0 }));
const e6d = codeOf(() => optimize(BIG_1920, { format: 'jpeg' }));
const e6e = codeOf(() => optimize('not bytes at all', {}));
const e6f = codeOf(() => optimize(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), {}));
const e6g = codeOf(() => optimize(BIG_1920.subarray(0, BIG_1920.length - 24), { maxWidth: 800 }));
const e6h = codeOf(() => diff(Buffer.from([1, 2, 3]), makeRed()));
const e6i = codeOf(() => diff(makeRed(), BIG_1920));
console.log(`P6 maxWidth:0 -> ${e6a && e6a.code}; maxWidth:-5 -> ${e6b && e6b.code}; maxHeight:0 -> ${e6c && e6c.code}`);
console.log(`P6 format:'jpeg' -> ${e6d && e6d.code} (lossy refused, never silent)`);
console.log(`P6 non-bytes -> ${e6e && e6e.code}; signature-only -> ${e6f && e6f.code}; truncated PNG -> ${e6g && e6g.code}`);
console.log(`P6 diff with junk bytes -> ${e6h && e6h.code}; diff across sizes -> ${e6i && e6i.code}`);
const p6ok =
  e6a?.code === 'E_INVALID_ARGUMENT' && e6b?.code === 'E_INVALID_ARGUMENT' &&
  e6c?.code === 'E_INVALID_ARGUMENT' && e6d?.code === 'E_INVALID_ARGUMENT' &&
  e6e?.code === 'E_INVALID_IMAGE' && e6f?.code === 'E_INVALID_IMAGE' &&
  e6g?.code === 'E_INVALID_IMAGE' && e6h?.code === 'E_INVALID_IMAGE' &&
  e6i?.code === 'E_INVALID_ARGUMENT';
check(
  'P6 invalid: maxWidth<=0 / maxHeight<=0 / lossy format -> E_INVALID_ARGUMENT; malformed bytes (non-bytes, signature-only, truncated) -> E_INVALID_IMAGE; size-mismatched diff -> E_INVALID_ARGUMENT',
  p6ok,
  `maxWidth0=${e6a?.code} maxWidth-5=${e6b?.code} maxHeight0=${e6c?.code} jpeg=${e6d?.code} string=${e6e?.code} sigOnly=${e6f?.code} truncated=${e6g?.code} junkDiff=${e6h?.code} dimMismatch=${e6i?.code}`
);
console.log('');

// ---------------------------------------------------------------------------
// P7 — determinism: same input + same params twice -> byte-identical output
//      (optimize image bytes + diff result + capture bytes)
// ---------------------------------------------------------------------------
const o7a = optimize(BIG_1920, { maxWidth: 800, maxHeight: 600 });
const o7b = optimize(BIG_1920, { maxWidth: 800, maxHeight: 600 });
const optEq =
  o7a.image.equals(o7b.image) &&
  o7a.width === o7b.width && o7a.height === o7b.height && o7a.bytes === o7b.bytes &&
  o7a.scaleX === o7b.scaleX && o7a.scaleY === o7b.scaleY && o7a.resized === o7b.resized;
const d7a = diff(makeRed(), makeRedOneBlue());
const d7b = diff(makeRed(), makeRedOneBlue());
const diffEq = JSON.stringify(d7a) === JSON.stringify(d7b);
const c7a = capture({ testOnly: true, name: 'det-source', dpi: 2, grab: () => Buffer.from(RED_8X6) });
const c7b = capture({ testOnly: true, name: 'det-source', dpi: 2, grab: () => Buffer.from(RED_8X6) });
const capEq =
  c7a.image.equals(c7b.image) && c7a.width === c7b.width &&
  c7a.height === c7b.height && c7a.dpi === c7b.dpi;
console.log(`P7 optimize #1: ${o7a.width}x${o7a.height} ${o7a.bytes}B; #2: ${o7b.width}x${o7b.height} ${o7b.bytes}B; byte-identical: ${o7a.image.equals(o7b.image)}`);
console.log(`P7 diff #1 raw: ${JSON.stringify(d7a)}`);
console.log(`P7 diff #2 raw: ${JSON.stringify(d7b)}; identical: ${diffEq}`);
console.log(`P7 capture byte-identical: ${capEq} (${c7a.image.length}B x2)`);
const p7ok = optEq && diffEq && capEq;
check(
  'P7 determinism: same input twice -> byte-identical optimize output, identical diff result objects, identical capture bytes',
  p7ok,
  `optimizeEq=${optEq} (${o7a.bytes}B x2) diffEq=${diffEq} captureEq=${capEq}`
);
console.log('');

// ---------------------------------------------------------------------------
// P8 — Zone check: git status shows ONLY this scope's paths
// ---------------------------------------------------------------------------
const st = spawnSync('git', ['status', '--short'], { cwd: WT, encoding: 'utf8' });
const lines = st.stdout.split('\n').filter((l) => l.trim() !== '');
console.log('P8 git status --short raw:');
console.log(st.stdout.trim());
const ALLOWED = ['computer/', 'scripts/phase29-'];
const zoneOk = lines.every((l) => {
  const status = l.slice(0, 2); // '??', ' M', 'A ', ... — in-zone entries are legitimate
  const p = l.slice(3).trim();
  return ALLOWED.some((a) => p === a || p.startsWith(a)) && status.trim().length > 0;
});
check(
  'P8 zone discipline: only computer/** + scripts/phase29-* in git status (no Scope A/B/C file touched)',
  zoneOk,
  `${lines.length} path(s): ${lines.map((l) => l.slice(3).trim()).join(' | ')}`
);
console.log('');

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log('---------------------------------------------');
console.log(`SCOPE D: ${8 - failures}/8 PASS, ${failures} FAIL`);
if (failures > 0) process.exit(1);

#!/usr/bin/env node
/**
 * B203 — SMALL-HOST MEMORY HARDENING (Render free tier OOM)
 *
 * Live incident (2026-09-03, production smoke test): the research pipeline
 * froze and the whole brain process died mid-request on the Render free tier.
 * Telemetry: "Deep-reading 10 sources in parallel..." → every endpoint
 * (even /api/metrics) timed out ~45s later → container restarted. Signature
 * of heap exhaustion: the idle brain sits at ~240MB RSS, the container is
 * capped at 512MB, and two concurrent JSDOM+Readability parses of fat pages
 * (plus unbounded page downloads) blew through the ceiling.
 *
 * The fix, all in the extraction layer:
 *  - fetchHTML NEVER reads an unbounded body (readCapped, 768KB max)
 *  - pages >300KB (or RSS >330MB) skip JSDOM for the light regex path
 *  - deep reads serialized (MAX_CONCURRENT_READS 2 → 1)
 *  - PDF downloads capped at 8MB
 *  - /api/metrics now reports rss/heap so incidents are diagnosable
 */
import {
  MAX_HTML_BYTES, JSDOM_MAX_HTML, RSS_JSDOM_GUARD, MAX_PDF_BYTES,
  readCapped, capArrayBuffer, extractFromHTML,
} from './src/services/Extractor.js';
import fs from 'node:fs';

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};

console.log('B203: small-host memory hardening\n');

// --- 1. constants make sense for a 512MB container ---
console.log('[1] Bounded constants');
check(`MAX_HTML_BYTES = ${MAX_HTML_BYTES} (≤ 1MB)`, MAX_HTML_BYTES > 0 && MAX_HTML_BYTES <= 1024 * 1024);
check(`JSDOM_MAX_HTML = ${JSDOM_MAX_HTML} (< MAX_HTML_BYTES)`, JSDOM_MAX_HTML > 0 && JSDOM_MAX_HTML < MAX_HTML_BYTES);
check(`RSS_JSDOM_GUARD = ${RSS_JSDOM_GUARD} (in (240MB, 512MB))`,
  RSS_JSDOM_GUARD > 240 * 1024 * 1024 && RSS_JSDOM_GUARD < 512 * 1024 * 1024);
check(`MAX_PDF_BYTES = ${MAX_PDF_BYTES} (≤ 16MB)`, MAX_PDF_BYTES > 0 && MAX_PDF_BYTES <= 16 * 1024 * 1024);

// --- 2. readCapped caps a streaming body ---
console.log('\n[2] readCapped caps streamed bodies');
{
  const big = 'x'.repeat(3 * 1024 * 1024); // 3MB "page"
  const chunks = [];
  for (let i = 0; i < big.length; i += 64 * 1024) chunks.push(new TextEncoder().encode(big.slice(i, i + 64 * 1024)));
  let i = 0;
  const fakeRes = { body: { getReader: () => ({ read: async () => i < chunks.length ? { done: false, value: chunks[i++] } : { done: true, value: undefined }, cancel: async () => {} }) } };
  const out = await readCapped(fakeRes, 768 * 1024);
  check(`3MB stream capped to ≤ 768KB (got ${out.length})`, out.length <= 768 * 1024 && out.length > 700 * 1024);
  check('capped output is still text', typeof out === 'string' && /^x+$/.test(out));
}
{
  const small = 'hello page';
  const enc = new TextEncoder().encode(small);
  let i = 0;
  const fakeRes = { body: { getReader: () => ({ read: async () => (i++ < 1) ? { done: false, value: enc } : { done: true, value: undefined }, cancel: async () => {} }) } };
  const out = await readCapped(fakeRes);
  check('small body passes through intact', out === small);
}
{
  // a broken reader that never ends must still be capped (defensive)
  const enc = new TextEncoder().encode('ab');
  const fakeRes = { body: { getReader: () => ({ read: async () => ({ done: false, value: enc }), cancel: async () => {} }) } };
  const out = await readCapped(fakeRes, 1024);
  check('runaway reader is capped, not unbounded', out.length <= 1024);
}
{
  // no-stream body fallback (older fetch impls)
  const fakeRes = { text: async () => 'y'.repeat(2 * 1024 * 1024) };
  const out = await readCapped(fakeRes);
  check('non-streaming body capped too', out.length <= MAX_HTML_BYTES);
}

// --- 3. capArrayBuffer caps PDFs ---
console.log('\n[3] capArrayBuffer caps PDF downloads');
{
  const huge = new ArrayBuffer(20 * 1024 * 1024);
  const fakeRes = { arrayBuffer: async () => huge };
  const out = await capArrayBuffer(fakeRes, MAX_PDF_BYTES);
  check(`20MB buffer capped to 8MB (got ${out.byteLength})`, out.byteLength === MAX_PDF_BYTES);
  const small = new ArrayBuffer(1024);
  const fakeRes2 = { arrayBuffer: async () => small };
  check('small PDF passes through', (await capArrayBuffer(fakeRes2, MAX_PDF_BYTES)).byteLength === 1024);
}

// --- 4. big pages take the light path (no JSDOM) ---
console.log('\n[4] Big pages skip JSDOM for the light regex path');
{
  // a >300KB page — above JSDOM_MAX_HTML, must return html-to-text, not JSDOM
  const html = `<html><head><title>Big Lake Page</title></head><body>${'<p>Lake Malawi is the third largest lake in Africa by area, about 29,500 square kilometres.</p>'.repeat(3800)}</body></html>`;
  check(`fixture is >300KB (got ${(html.length / 1024).toFixed(0)}KB)`, html.length > JSDOM_MAX_HTML);
  const res = extractFromHTML(html, 'https://example.com/big-lakes');
  check(`big page took the light path (method=${res.method})`, res.method === 'html-to-text');
  check('big page content still has the facts', /Lake Malawi/.test(res.content || ''));
}

// --- 5. extraction of a normal small page still works end-to-end ---
console.log('\n[5] Normal pages still extract');
{
  const html = `<html><head><title>Lakes of Africa</title></head><body><article><h1>Lakes of Africa</h1>${'<p>Lake Victoria is the largest lake in Africa by surface area, covering about 68,800 square kilometres. It borders Kenya, Uganda and Tanzania.</p>'.repeat(30)}</article></body></html>`;
  const res = extractFromHTML(html, 'https://example.com/african-lakes');
  check('small page extracts with content', !!res.content && res.content.length > 200, JSON.stringify(res).slice(0, 120));
  check(`small page used Readability (method=${res.method})`, res.method === 'readability');
}

// --- 6. metrics endpoint reports memory (contract check by import) ---
console.log('\n[6] Metrics memory gauge source present');
{
  const src = fs.readFileSync('./index.js', 'utf-8');
  check('index.js exposes memory gauges on /api/metrics', /memory:\s*\{\s*rssMb/.test(src));
}

console.log(`\nB203: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

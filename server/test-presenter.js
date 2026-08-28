/**
 * B169 — PRESENTER TESTS (the answer-display layer).
 *
 *   chart engine    → bar/line/pie SVGs, values/labels/axes present,
 *                     garbage + overflow never crash
 *   image search    → real Commons lookup (datacenter-proof), sane shape
 *   cookies fix     → raw + base64 cookies resolve to a --cookies file
 *   contract        → FORMAT_RULES tells the model how to present
 *   renderer wiring → chart fence + image markdown + mermaid + math
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
let failures = 0;
const ok = (name, cond) => {
  console.log(`${cond ? '✅' : '❌'} ${name}`);
  if (!cond) failures += 1;
};

/* ══════════════ 1. CHART ENGINE ══════════════ */
console.log('\n== 1. chart engine (real SVG graphs) ==');
{
  const { chartSvg } = await import('../src/utils/chartSvg.js');

  const bar = chartSvg(JSON.stringify({ type: 'bar', title: 'Revenue', unit: 'KSh', data: { Q1: 120, Q2: 180, Q3: 90 } }));
  ok('bar chart renders an SVG', bar.svg && bar.svg.startsWith('<svg') && bar.svg.includes('</svg>'));
  ok('bar chart shows the values + labels', bar.svg.includes('120') && bar.svg.includes('180') && bar.svg.includes('Q2'));
  ok('bar chart has axes gridlines', bar.svg.includes('<line'));

  const line = chartSvg({ type: 'line', title: 'Growth', data: [{ label: 'Jan', value: 5 }, { label: 'Feb', value: 9 }, { label: 'Mar', value: 14 }] });
  ok('line chart draws a connected path', line.svg.includes('<path') && line.svg.includes('stroke'));

  const pie = chartSvg({ type: 'pie', title: 'Market share', data: { Chrome: 65, Firefox: 15, Safari: 20 } });
  ok('pie chart draws slices + percentages', pie.svg.includes('<path') && pie.svg.includes('%'));

  const grouped = chartSvg({ type: 'bar', data: [{ label: 'A', value: 10, value2: 6 }, { label: 'B', value: 8, value2: 12 }] });
  ok('grouped bars (two series) render both', grouped.svg.includes('series 2'));

  ok('garbage spec → honest error, no crash', chartSvg('not json').error && !chartSvg('not json').svg);
  ok('empty data → honest error', chartSvg({ type: 'bar', data: {} }).error);
  ok('25 rows capped to 24, no crash', !!chartSvg({ type: 'bar', data: Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`r${i}`, i])) }).svg);
  ok('type defaults to bar', chartSvg({ data: { a: 1 } }).svg.includes('<rect'));
  ok('thousand separators on big numbers', chartSvg({ type: 'bar', data: { big: 12500 } }).svg.includes('12,500'));
}

/* ══════════════ 2. IMAGE SEARCH (live) ══════════════ */
console.log('\n== 2. image search (Wikimedia Commons, live) ==');
{
  const { imageSearch } = await import('./src/services/ImageSearch.js');
  const r = await imageSearch('great wall of china', { limit: 3 });
  ok('live Commons search works from a datacenter IP', r.ok === true);
  if (r.ok) {
    const img = r.images[0];
    ok('image has thumb + full url + title', img.thumb.startsWith('https://upload.wikimedia.org') && img.url.startsWith('https://') && img.title.length > 3);
    ok('license attributed', typeof img.license === 'string' && img.license.length > 0);
    ok(`got ${r.images.length} images (≤ limit)`, r.images.length >= 1 && r.images.length <= 3);
  }
  const bad = await imageSearch('');
  ok('empty query → honest error', !bad.ok);
}

/* ══════════════ 3. COOKIES FIX ══════════════ */
console.log('\n== 3. cookies fix (YouTube server wall) ==');
{
  const VW = await import('./src/services/VideoWatch.js');
  // raw Netscape content via env
  process.env.YTDLP_COOKIES = '# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tVISITOR_INFO1_LIVE\tabc\n';
  const f1 = VW.resolveCookiesFile();
  ok('raw cookies env → written file with the content', !!f1 && fs.readFileSync(f1, 'utf-8').includes('VISITOR_INFO1_LIVE'));
  delete process.env.YTDLP_COOKIES;
  // base64 variant (single-line friendly for Render's env UI)
  const b64 = Buffer.from('# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tVISITOR_INFO1_LIVE\txyz\n').toString('base64');
  process.env.YTDLP_COOKIES_B64 = b64;
  VW.__resetCookiesFile();
  const f2 = VW.resolveCookiesFile();
  ok('base64 cookies env → decoded + written', !!f2 && fs.readFileSync(f2, 'utf-8').includes('VISITOR_INFO1_LIVE'));
  delete process.env.YTDLP_COOKIES_B64;
  VW.__resetCookiesFile();
  ok('no cookies → null (player-client workaround still applies)', VW.resolveCookiesFile() === null);
}

/* ══════════════ 3b. PICTURE INTENT (B170) ══════════════ */
console.log('\n== 3b. natural picture intent ==');
{
  const { detectPictureIntent } = await import('./src/services/ImageSearch.js');
  ok('"show me a picture of a giraffe" → subject extracted', detectPictureIntent('show me a picture of a giraffe')?.subject === 'giraffe');
  ok('"what does a blue whale look like" → detected', !!detectPictureIntent('what does a blue whale look like'));
  ok('build requests NOT hijacked', detectPictureIntent('build me a website') === null);
  ok('URLs left to the video/research paths', detectPictureIntent('show me a picture of https://youtu.be/x') === null);
  ok('normal explanations NOT hijacked', detectPictureIntent('explain photosynthesis') === null);
  const idx = fs.readFileSync('./index.js', 'utf-8');
  ok('chat route handles picture intent before planning', idx.includes('B170 — NATURAL PICTURE INTENT'));
}

/* ══════════════ 4. PRESENTER CONTRACT + RENDERER WIRING ══════════════ */
console.log('\n== 4. presenter contract + renderer wiring ==');
{
  const { FORMAT_RULES } = await import('./src/services/Formatting.js');
  ok('contract: chart fence documented', FORMAT_RULES.includes('```chart'));
  ok('contract: mermaid for diagrams', FORMAT_RULES.includes('mermaid'));
  ok('contract: image_search for pictures', FORMAT_RULES.includes('image_search'));
  ok('contract: tables for numbers', FORMAT_RULES.includes('TABLE'));

  const mr = fs.readFileSync(path.join(ROOT, 'src/components/MarkdownRenderer.jsx'), 'utf-8');
  ok('renderer: chart fence handled (ChartBlock)', mr.includes("lang === 'chart'") && mr.includes('ChartBlock'));
  ok('renderer: useMemo imported (runtime safety)', /import React, {[^}]*useMemo/.test(mr));
  ok('renderer: mermaid diagrams', mr.includes('MermaidBlock'));
  ok('renderer: math (KaTeX) pipeline', mr.includes('remarkMath') && mr.includes('rehypeKatex'));
  ok('renderer: images render', mr.includes('MarkdownImage'));

  const plugin = fs.readFileSync(path.join(ROOT, 'server/plugins/image-search/plugin.js'), 'utf-8');
  ok('image_search tool registered', plugin.includes("slug: 'image_search'"));
}

console.log(`\n${failures === 0 ? '🎉 ALL B169 PRESENTER CHECKS PASSED' : `💥 ${failures} FAILURES`}`);
process.exit(failures === 0 ? 0 : 1);

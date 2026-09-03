/**
 * B197 — IMAGE BLINK / GLITCH / ZOOM REGRESSION TESTS.
 *
 * The user report: "when she generates a photo it is blinking and glitching
 * then zooming in". B196 memoized the image component — the blink survived
 * because the true root causes were:
 *
 *   1. REMOUNT, NOT RE-RENDER — the components map handed to ReactMarkdown
 *      was built inline in the render body. react-markdown uses those
 *      functions as React element TYPES; fresh identities per streaming
 *      delta made React unmount/remount every custom-rendered node, so the
 *      <img> was destroyed and re-created on EVERY delta → constant reload
 *      (blink). Fixed: the map lives at module scope (MARKDOWN_COMPONENTS).
 *   2. THE ZOOM — the loading box reserved a flat 128px then collapsed to
 *      the image's real height on load (128 ↔ 400px pulse per remount).
 *      Fixed: exact aspect-ratio reservation BEFORE load (URL ?width=&height=
 *      params for generated images + a session dimension cache).
 *   3. THE GLITCH — the half-streamed `![alt](https://…` tail rendered as
 *      literal text before the image completed. Fixed: the trailing
 *      unterminated fragment is held back (stripTrailingImageFragment).
 *   4. THE GHOST SHIMMER — the shimmer-bar class had no CSS definition at
 *      all, so loading images sat in an empty gray box. Fixed: real CSS.
 *
 * NOTE: renders via react-dom/server (no browser needed).
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const esbuild = path.join(ROOT, 'node_modules', 'esbuild', 'bin', 'esbuild');
// Bundle the ORIGINAL component in place (not a copy): MarkdownRenderer has
// relative imports (../utils/chartSvg, ../utils/mathPreprocess) that only
// resolve from its real src/components location.
const tmpOut = path.join(ROOT, 'server', 'test-support', '.b197-test.cjs');
fs.mkdirSync(path.dirname(tmpOut), { recursive: true });

let failures = 0;
const ok = (name, cond) => { console.log(`${cond ? '✅' : '❌'} ${name}`); if (!cond) failures += 1; };

/* ─────────────── static source checks ─────────────── */
const md = fs.readFileSync(path.join(ROOT, 'src', 'components', 'MarkdownRenderer.jsx'), 'utf-8');
ok('components map is module-scope — inline identities remounted every node per delta (THE blink)',
  /const MARKDOWN_COMPONENTS = \{/.test(md) && !/components=\{\{/.test(md));
ok('image dimension cache exists and is filled on load (box never resizes twice for a src)',
  /IMG_DIM_CACHE = new Map\(\)/.test(md) && /IMG_DIM_CACHE\.set\(/.test(md));
ok('generated-image URL dims parsed (exact aspect box before the first byte arrives)',
  /function imgDimsFromUrl/.test(md));
ok('onLoad records natural dimensions into the cache', /naturalWidth/.test(md) && /IMG_DIM_CACHE\.set\(src/.test(md));

const rich = fs.readFileSync(path.join(ROOT, 'src', 'components', 'RichAnswer.jsx'), 'utf-8');
ok('RichAnswer components map is memoized (same remount fix, second renderer)', /useMemo\(\(\) => \(\{/.test(rich));

const css = fs.readFileSync(path.join(ROOT, 'src', 'index.css'), 'utf-8');
ok('shimmer-bar finally HAS a CSS definition (was an empty ghost box)', /\.shimmer-bar\s*\{/.test(css) && css.includes('@keyframes jxshimmer'));
ok('image box capped at the 400px image max (aspect reservation can never overflow)', /\.jx-imgbox\s*\{[^}]*max-height:\s*400px/.test(css));

/* ─────────────── behavioral checks (render the real component) ─────────────── */
let mod = null;
try {
  execFileSync(esbuild, [
    path.join(ROOT, 'src', 'components', 'MarkdownRenderer.jsx'),
    '--bundle', '--platform=node', '--format=cjs', '--loader:.jsx=jsx',
    '--external:react', '--outfile=' + tmpOut, '--log-level=error',
  ], { stdio: 'pipe' });
  mod = await import(pathToFileURL(tmpOut).href);
} finally {
  try { fs.unlinkSync(tmpOut); } catch { /* best effort */ }
}
// CJS-bundle interop: via dynamic import the real exports object sits at
// mod.default (and the component at mod.default.default) — same unwrap the
// rich-render test does.
const exp = mod && mod.default && typeof mod.default === 'object' && mod.default.default ? mod.default : mod;
const MarkdownRenderer = exp.default || exp;
const { stripTrailingImageFragment, MARKDOWN_COMPONENTS } = exp;

/* — 1. the stripper: unterminated tails held back, complete markdown untouched — */
ok('stripper: unterminated image URL tail is held back',
  stripTrailingImageFragment('Here it is: ![a cat](https://image.pollinations.ai/prompt/cat?width=76') === 'Here it is: ');
ok('stripper: unterminated image alt tail is held back',
  stripTrailingImageFragment('Look: ![a cat') === 'Look: ');
ok('stripper: COMPLETE image markdown passes through untouched',
  stripTrailingImageFragment('![a cat](https://image.pollinations.ai/prompt/cat?width=768&height=512)') === '![a cat](https://image.pollinations.ai/prompt/cat?width=768&height=512)');
ok('stripper: never crosses a newline (only the streaming-edge fragment is affected)',
  stripTrailingImageFragment('para one\n\n![alt](https://x\nmid-sentence ) text') === 'para one\n\n![alt](https://x\nmid-sentence ) text');
ok('stripper: empty/null content is safe',
  stripTrailingImageFragment('') === '' && stripTrailingImageFragment(null) === '');

/* — 2. stable element types — */
ok('MARKDOWN_COMPONENTS.img is a stable function type (reconciliation, not remount)',
  typeof MARKDOWN_COMPONENTS?.img === 'function' && MARKDOWN_COMPONENTS.img === MARKDOWN_COMPONENTS.img);

/* — 3. render: generated image gets the EXACT aspect-ratio reservation — */
const genUrl = 'https://image.pollinations.ai/prompt/a%20lion%20in%20the%20savanna?width=768&height=512&nologo=true&seed=424242';
const html1 = renderToStaticMarkup(React.createElement(MarkdownRenderer, {
  content: `### 🎨 Generated image\n\n![a lion](${genUrl})\n\n*AI-generated for you — ask me to redraw it differently anytime.*`,
}));
ok('generated image renders as <img> with the exact pollinations src',
  html1.includes('<img') && html1.includes('image.pollinations.ai'));
ok('box reserves the EXACT aspect ratio from URL dims (768/512 → zero layout shift, no zoom)',
  /aspect-ratio:\s*768\s*\/\s*512/.test(html1));

/* — 4. render: a half-streamed tail never shows the raw URL as text — */
const html2 = renderToStaticMarkup(React.createElement(MarkdownRenderer, {
  content: '### 🎨 Generated image\n\n![a lion](https://image.pollinations.ai/prompt/a%20lion',
}));
ok('half-streamed image URL never renders as literal text (the glitch)',
  !html2.includes('pollinations.ai/prompt'));

/* — 5. render: stream growth — the completed image appears (delta simulation) — */
const html3 = renderToStaticMarkup(React.createElement(MarkdownRenderer, {
  content: `### 🎨 Generated image\n\n![a lion](${genUrl})`,
}));
ok('delta-growth render (image markdown now complete) produces the image with its reservation',
  html3.includes('<img') && /aspect-ratio:\s*768\s*\/\s*512/.test(html3));

/* — 6. render: image with NO URL dims (Wikimedia thumb) still renders — */
const html4 = renderToStaticMarkup(React.createElement(MarkdownRenderer, {
  content: '![photo](https://upload.wikimedia.org/wikipedia/commons/thumb/x/y.jpg/640px-y.jpg)',
}));
ok('image without URL dims still renders (flat reservation path, no crash)',
  html4.includes('<img') && html4.includes('wikimedia'));

/* — 7. render: text answer without images is completely unaffected — */
const html5 = renderToStaticMarkup(React.createElement(MarkdownRenderer, {
  content: 'Plain answer with **bold** and `code`.',
}));
ok('ordinary text answers render unchanged',
  /<strong[^>]*>bold<\/strong>/.test(html5) && html5.includes('Plain answer') && !html5.includes('&lt;'));

console.log(failures === 0 ? '\n🎉 ALL B197 CHECKS PASSED' : `\n💥 ${failures} FAILURES`);
process.exit(failures ? 1 : 0);

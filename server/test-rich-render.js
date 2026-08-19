/**
 * B151 — RICH ANSWER RENDERER TEST.
 * Renders a document exercising every content type through RichAnswer
 * (react-markdown + GFM + math + highlight + callouts) and asserts the
 * generated HTML contains the right native components — and that no raw
 * markdown leaks through.
 *
 * NOTE: this test renders via react-dom/server (no browser needed).
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// esbuild is not needed here: transpile RichAnswer.jsx on the fly via
// react-markdown's sibling — instead we import the .jsx through a tiny
// loader-free approach: copy to .js and run with node --experimental? No —
// node can't parse JSX. So we bundle with esbuild into CJS at test time.
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const esbuild = path.join(ROOT, 'node_modules', 'esbuild', 'bin', 'esbuild');
const tmpSrc = path.join(ROOT, 'server', 'test-support', '.rich-test.jsx');
const tmpOut = path.join(ROOT, 'server', 'test-support', '.rich-test.cjs');
fs.copyFileSync(path.join(ROOT, 'src', 'components', 'RichAnswer.jsx'), tmpSrc);

const doc = [
  '# Weather App Review',
  '',
  '## Overview',
  '',
  'This is **bold** and *italic* and `inline code` with emojis 🎉 ✅.',
  '',
  '> [!NOTE]',
  '> This is a note callout.',
  '',
  '- First bullet',
  '- Second bullet',
  '  - Nested bullet',
  '',
  '1. Step one',
  '2. Step two',
  '   1. Nested step a',
  '',
  '- [x] Task done',
  '- [ ] Task pending',
  '',
  '```javascript',
  'function greet(name) {',
  '  return `Hi ${name}`;',
  '}',
  '```',
  '',
  'Inline math $E = mc^2$ and display:',
  '',
  '$$',
  '\\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}',
  '$$',
  '',
  '| City | Temp |',
  '|------|------|',
  '| Nairobi | 21° |',
  '',
  '> "Quote" — Amani',
  '',
  '[Repo link](https://github.com/example/repo)',
  '',
  '---',
  '',
  'Keep it **simple**.',
].join('\n');

let html = '';
try {
  execFileSync(esbuild, [tmpSrc, '--bundle', '--platform=node', '--format=cjs', '--loader:.jsx=jsx', '--external:react', '--outfile=' + tmpOut, '--log-level=error'], { stdio: 'pipe' });
  const mod = await import(pathToFileURL(tmpOut).href);
  const RichAnswer = (mod && mod.default && mod.default.default) ? mod.default.default : (mod && mod.default) || mod;
  html = renderToStaticMarkup(React.createElement(RichAnswer, { text: doc }));
} finally {
  try { fs.unlinkSync(tmpSrc); } catch { /* noop */ }
  try { fs.unlinkSync(tmpOut); } catch { /* noop */ }
}

let failures = 0;
const ok = (name, cond) => {
  console.log(`${cond ? '✅' : '❌'} ${name}`);
  if (!cond) failures += 1;
};

ok('headings render (h1/h2)', html.includes('jx-h1') && html.includes('jx-h2'));
ok('bold/italic render', html.includes('<strong>') && html.includes('<em>'));
ok('emojis preserved', html.includes('🎉') && html.includes('✅'));
ok('inline code styled', html.includes('jx-icode'));
ok('nested bullet lists', (html.match(/jx-ul/g) || []).length >= 2);
ok('numbered list', html.includes('jx-ol'));
ok('checklist done + pending', html.includes('jx-box checked') && html.includes('jx-task'));
ok('code block with language + copy', html.includes('language-javascript') && html.includes('jx-code') && html.includes('Copy'));
ok('inline math rendered (KaTeX, no raw $)', html.includes('katex') && !html.includes('$E = mc^2$'));
ok('display math rendered', html.includes('katex-display'));
ok('table rendered', html.includes('jx-table') && html.includes('Nairobi'));
ok('quote with attribution', html.includes('jx-quote') && html.includes('Amani'));
ok('link clickable', html.includes('jx-link') && html.includes('target="_blank"'));
ok('callout note', html.includes('jx-callout-note') && html.includes('Note'));
ok('divider', html.includes('jx-hr'));
ok('no raw markdown leaks', !html.includes('**bold**') && !html.includes('## Weather'));

console.log(`\n${failures === 0 ? '🎉 ALL RICH RENDER CHECKS PASSED' : `💥 ${failures} FAILURES`}`);
process.exit(failures === 0 ? 0 : 1);

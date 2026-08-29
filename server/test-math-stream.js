/**
 * B174 — MATH-SAFE STREAMING TESTS.
 * The user saw half-typed LaTeX ("\\frac{\\te…") — unreadable. Fixes:
 *   server  — createMathStreamBuffer: incomplete $ spans / trailing \\commands
 *             are held back and released WHOLE; flushed before done
 *   client  — line-chunked typewriter (a formula is never sliced) + forgiving
 *             KaTeX (soft error color, never raw dumps)
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

const { createMathStreamBuffer } = await import('./src/services/Formatting.js');

/* ══════════════ 1. THE BUFFER ══════════════ */
console.log('\n== 1. math stream buffer ==');
{
  const b = createMathStreamBuffer();
  ok('plain text passes instantly', b.push('The answer is ') === 'The answer is ');
  ok('unclosed $ held back', b.push('$\\frac{1}{') === '');
  ok('still held while the formula grows', b.push('2} + \\sqrt{3') === '');
  const rel = b.push('}$ miles');
  ok('closed formula releases WHOLE', rel.includes('\\frac{1}{2}') && rel.includes('\\sqrt{3}') && rel.endsWith('$ miles'));

  const c = createMathStreamBuffer();
  ok('trailing \\command held (name still typing)', c.push('value \\ti') === 'value ');
  ok('command completes and releases', c.push('mes 4') === '\\times 4');
  ok('flush releases any held tail', (createMathStreamBuffer().push('x $\\frac'), true) && (() => { const d = createMathStreamBuffer(); d.push('x $\\frac{1}{2'); const f = d.flush(); return f.includes('\\frac{1}{2'); })());
}

/* ══════════════ 2. THE REAL TRAIN ANSWER (from the user's logs) ══════════════ */
console.log('\n== 2. real math answer streams with even-$ parity ==');
{
  const TRAIN = `- Distance covered = $80 \\text{ km/h} \\times 1 \\text{ h} = 80 \\text{ km}$
- Remaining distance = $480 - 80 = 400 \\text{ km}$
- Relative speed = $80 + 100 = 180 \\text{ km/h}$
- Time = $\\frac{\\text{Distance}}{\\text{Relative speed}} = \\frac{400}{180} = 2.22 \\text{ h}$
- Meeting time = $9{:}00 + 2\\text{ h } 13\\text{ min} = 11{:}13 \\text{am}$`;
  // feed it in TINY char chunks (worst case: every boundary can slice math)
  const b = createMathStreamBuffer();
  let shown = '';
  let parityEverOdd = false;
  for (let i = 0; i < TRAIN.length; i += 3) {
    shown += b.push(TRAIN.slice(i, i + 3));
    if ((shown.match(/\$/g) || []).length % 2 === 1) parityEverOdd = false === false; // track
    if ((shown.match(/\$/g) || []).length % 2 !== 0) parityEverOdd = true;
  }
  shown += b.flush();
  ok('never shows an ODD number of $ while streaming (no half formulas)', parityEverOdd === false);
  ok('everything released by flush', shown === TRAIN);
}

/* ══════════════ 2b. DELIMITER NORMALIZATION (B174c — the real user bug) ══════════════ */
console.log('\n== 2b. \\( \\) and \\[ \\] become renderable math ==');
{
  const { normalizeMathDelimiters } = await import('./src/services/Formatting.js');
  const t = normalizeMathDelimiters('To solve \\( \\frac{2}{3} + \\frac{1}{4} \\), find the LCM. \\[ x = 12 \\]');
  ok('\\( ... \\) → $ ... $', t.includes('$\\frac{2}{3} + \\frac{1}{4}$'));
  ok('\\[ ... \\] → $$ ... $$', t.includes('$$') && t.includes('x = 12'));
  ok('text without latex passes untouched', normalizeMathDelimiters('plain answer 42') === 'plain answer 42');
  const idx = fs.readFileSync('./index.js', 'utf-8');
  ok('done summaries + stream releases + think text all normalized',
    idx.includes('normalizeMathDelimiters(data.summary)')
    && idx.includes('normalizeMathDelimiters(mathStream.push')
    && idx.includes('sanitizeStreamText(normalizeMathDelimiters'));
}

/* ══════════════ 3. WIRING ══════════════ */
console.log('\n== 3. wiring ==');
{
  const idx = fs.readFileSync('./index.js', 'utf-8');
  ok('chat route buffers stream deltas (B174)', idx.includes('mathStream.push(data.text)') && idx.includes('createMathStreamBuffer'));
  ok('held tail flushed before done', idx.includes('mathStream.flush()'));
  ok('empty safe deltas are skipped (no dead events)', idx.includes('if (!safe) return;'));
  const tw = fs.readFileSync(path.join(ROOT, 'src/hooks/useTypewriter.js'), 'utf-8');
  ok('typewriter reveals whole LINES (never slices a formula)', tw.includes('lineEnds') && tw.includes('LINE-CHUNKED'));
  const mr = fs.readFileSync(path.join(ROOT, 'src/components/MarkdownRenderer.jsx'), 'utf-8');
  ok('KaTeX forgiving + soft error color', mr.includes("strict: 'ignore'") && mr.includes('errorColor'));
}

console.log(`\n${failures === 0 ? '🎉 ALL B174 MATH-STREAM CHECKS PASSED' : `💥 ${failures} FAILURES`}`);
process.exit(failures === 0 ? 0 : 1);

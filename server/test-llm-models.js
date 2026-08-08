// Regression test: image MIME detection + no stale Gemini model names (gemini-1.5-flash-latest was removed from Google's API).
import { mimeFromDataUrl } from './src/services/LLMClient.js';

let failures = 0;
const check = (label, actual, expect) => {
  const ok = actual === expect;
  if (!ok) failures++;
  console.log(`${ok ? '✅' : '❌'} ${label}: got "${actual}" expected "${expect}"`);
};

// Camera frames are JPEG; uploads can be png/webp; raw base64 defaults to png.
check('jpeg data URL', mimeFromDataUrl('data:image/jpeg;base64,/9j/4AAQ=='), 'image/jpeg');
check('png data URL', mimeFromDataUrl('data:image/png;base64,iVBORw0KGgo=='), 'image/png');
check('webp data URL', mimeFromDataUrl('data:image/webp;base64,UklGR=='), 'image/webp');
check('raw base64 fallback', mimeFromDataUrl('/9j/4AAQ=='), 'image/png');
check('empty fallback', mimeFromDataUrl(''), 'image/png');

// No stale model names used as actual models (comments may mention the removed name).
import fs from 'fs';
const src = fs.readFileSync(new URL('./src/services/LLMClient.js', import.meta.url), 'utf-8');
const codeOnly = src.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
const stale = codeOnly.match(/gemini-1\.5-flash-latest/g) || [];
if (stale.length > 0) failures++;
console.log(`${stale.length === 0 ? '✅' : '❌'} no stale gemini-1.5-flash-latest in LLMClient.js (found ${stale.length})`);

console.log(failures === 0 ? '\nALL LLM MODEL TESTS PASSED' : `\n${failures} LLM MODEL TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);

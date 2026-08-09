/**
 * Tests for the "build → verify → live preview" coding pipeline:
 *  - Runner: HTML apps get their inline <script> syntax-checked (good = success
 *    with a preview URL, broken = failure so the debug loop can fix it)
 *  - LLMClient: exports load and behave (no keys needed for import)
 *
 * Run:  WORKSPACE_DIR=/tmp/jexi-preview-test node server/test-preview.js
 */
import fs from 'node:fs';
import { runFile } from './src/services/Runner.js';
import { resolveKeys, mimeFromDataUrl } from './src/services/LLMClient.js';

let passed = 0;
let failed = 0;
const check = (label, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ✅ ${label}${extra ? ` — ${extra}` : ''}`); }
  else { failed++; console.log(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
};

fs.mkdirSync(process.env.WORKSPACE_DIR, { recursive: true });

console.log('=== 1) HTML app with VALID inline JS ===');
{
  const html = `<!DOCTYPE html><html><head><title>Calc</title></head><body>
<h1>Calculator</h1>
<script>
function add(a, b) { return a + b; }
document.getElementById('x').textContent = add(2, 3);
</script>
</body></html>`;
  fs.writeFileSync(`${process.env.WORKSPACE_DIR}/calculator.html`, html);
  const res = await runFile('calculator.html');
  check('passes verification', res.success === true);
  check('returns a live preview URL', typeof res.url === 'string' && res.url.includes('/preview/calculator.html'), res.url);
  check('notes the JS check in output', /JavaScript passed syntax check/.test(res.output));
}

console.log('=== 2) HTML app with BROKEN inline JS (must fail → debug loop) ===');
{
  const html = `<!DOCTYPE html><html><head><title>Broken</title></head><body>
<script>
function broken() {
  const x = ;
</script>
</body></html>`;
  fs.writeFileSync(`${process.env.WORKSPACE_DIR}/broken.html`, html);
  const res = await runFile('broken.html');
  check('detects the JS error', res.success === false);
  check('error output identifies the script', /JavaScript error in inline script/.test(res.output), res.output.slice(0, 80));
}

console.log('=== 3) HTML with no scripts (still fine) ===');
{
  fs.writeFileSync(`${process.env.WORKSPACE_DIR}/static.html`, '<h1>Just HTML</h1>');
  const res = await runFile('static.html');
  check('static HTML succeeds', res.success === true);
}

console.log('=== 4) LLMClient exports ===');
{
  const keys = resolveKeys();
  check('resolveKeys returns groqKey + geminiKey keys', 'groqKey' in keys && 'geminiKey' in keys);
  check('mimeFromDataUrl parses image type', mimeFromDataUrl('data:image/jpeg;base64,xxx') === 'image/jpeg');
}

console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
process.exit(failed ? 1 : 0);

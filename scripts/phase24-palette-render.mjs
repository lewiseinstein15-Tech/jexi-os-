// phase-24(0c): render the two palette approval PNGs from _palette-preview.html.
// Headless chromium via the repo's existing playwright devDependency. No new deps.
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const page_url = 'file://' + path.join(root, 'interfaces/ui/web/console/_palette-preview.html');
const OUT = [
  ['#swatches', path.join(root, 'docs/phase24-scope0-palette-swatches.png')],
  ['#surface', path.join(root, 'docs/phase24-scope0-palette-test-surface.png')],
];

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1060, height: 900 }, deviceScaleFactor: 2 });
await page.goto(page_url, { waitUntil: 'domcontentloaded' });
for (const [sel, out] of OUT) {
  const el = await page.$(sel);
  if (!el) { console.error(`FAIL — selector ${sel} not found`); process.exit(1); }
  await el.screenshot({ path: out });
  console.log(`rendered ${out}`);
}
await browser.close();
console.log('DONE');

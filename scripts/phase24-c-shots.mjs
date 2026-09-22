// phase-24(C) evidence: settings surface on the live console.
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = (n) => path.join(root, 'docs', n);
const URL0 = 'http://localhost:3000/ui/web/console/shell/index.html';

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });

// P1 — settings route renders, sidebar intact
await page.goto(URL0 + '#/settings', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.p24-settings');
const items = await page.$$eval('.jx-nav-item', (els) => els.map((e) => e.textContent.trim()));
const active = await page.$eval('.jx-nav-item.is-active', (e) => e.textContent.trim());
console.log('P1 sidebar:', JSON.stringify(items), 'active:', active);
await page.screenshot({ path: OUT('phase24-scopeC-settings-main.png') });
console.log('P1 shot: settings-main');

// P2 — provider + model lists
const providers = await page.$$eval('.p24-select >> nth=0 >> option', (els) => els.map((e) => e.value));
console.log('P2 providers:', JSON.stringify(providers));
await page.selectOption('.p24-select >> nth=0', 'anthropic');
const modelsA = await page.$$eval('.p24-select >> nth=1 >> option', (els) => els.map((e) => e.value));
await page.selectOption('.p24-select >> nth=0', 'openai');
const modelsO = await page.$$eval('.p24-select >> nth=1 >> option', (els) => els.map((e) => e.value));
console.log('P2 models[anthropic]:', JSON.stringify(modelsA), 'models[openai]:', JSON.stringify(modelsO));
await page.selectOption('.p24-select >> nth=0', 'anthropic');
await page.locator('.p24-section').filter({ has: page.locator('h2:text-is("Provider")') }).screenshot({ path: OUT('phase24-scopeC-settings-provider.png') });
console.log('P2 shot: settings-provider');

// P3 — keyRef accepted then refused
await page.fill('.p24-keyref .p24-input', 'ANTHROPIC_API_KEY');
await page.click('.p24-keyref .p24-send');
await page.waitForSelector('.p24-keyref-ok');
console.log('P3 accepted:', await page.$eval('.p24-keyref-ok', (e) => e.textContent));
await page.screenshot({ path: OUT('phase24-scopeC-settings-keyref-ok.png') });
console.log('P3 shot: settings-keyref-ok');
await page.fill('.p24-keyref .p24-input', 'sk-inline-abc123');
await page.click('.p24-keyref .p24-send');
await page.waitForSelector('.p24-keyref-refused');
console.log('P3 refused:', await page.$eval('.p24-keyref-refused', (e) => e.textContent));
await page.screenshot({ path: OUT('phase24-scopeC-settings-keyref-refused.png') });
console.log('P3 shot: settings-keyref-refused');

// P5 — theme light + persistence across reload
await page.click('.p24-btn-group[aria-label="Theme"] >> text=light');
await page.waitForSelector('[data-theme="light"]');
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('.p24-settings');
const persisted = await page.$eval('.jx-shell', (e) => e.getAttribute('data-theme'));
console.log('P5 theme after reload:', persisted);
await page.screenshot({ path: OUT('phase24-scopeC-settings-general.png') });
console.log('P5 shot: settings-general (light, persisted)');
await page.click('.p24-btn-group[aria-label="Theme"] >> text=dark');

// P4 — mode switches live
await page.click('.p24-btn-group[aria-label="Display mode"] >> text=full');
await page.click('.p24-btn-group[aria-label="Interaction mode"] >> text=act');
await page.waitForSelector('.p24-btn-group[aria-label="Display mode"] .is-active');
const live = await page.$$eval('.p24-btn-group .is-active', (els) => els.map((e) => e.textContent));
console.log('P4 live active modes:', JSON.stringify(live));
await page.screenshot({ path: OUT('phase24-scopeC-settings-modes.png') });
console.log('P4 shot: settings-modes');

// P6 — chat reflects full verbosity on the next tool event
await page.click('.jx-nav-item >> text=Chat');
await page.waitForSelector('.p24-composer');
const longQ = 'write a detailed scheduler note: '.repeat(4) + 'Please explain the scheduler in detail. '.repeat(10) + 'Cover the cron event and condition triggers thoroughly so the tool arguments exceed six hundred characters for the verbosity check.';
await page.fill('.p24-input', longQ);
await page.click('.p24-send');
await page.waitForSelector('.p24-approval', { timeout: 10000 });
await page.click('.p24-approval >> text=approve');
try {
  await page.waitForSelector('.p24-toolcard .p24-tool-body', { timeout: 20000 });
} catch {
  const dump = await page.$$eval('.p24-row', (rs) => rs.map((r) => r.className + ' :: ' + r.textContent.slice(0, 90)));
  console.log('P6 row dump:', JSON.stringify(dump, null, 1));
  throw new Error('no tool body rendered');
}
const body = await page.$eval('.p24-toolcard.tool-use .p24-tool-body', (e) => e.textContent);
console.log('P6 tool body length:', body.length, '(compact would clip at 600; full shows', '>=600)');
console.log('P6 truncated?', body.includes('…'));
await page.screenshot({ path: OUT('phase24-scopeC-settings-mode-live.png') });
console.log('P6 shot: settings-mode-live');

await browser.close();
console.log('DONE');

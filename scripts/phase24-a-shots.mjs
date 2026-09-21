// phase-24(A) evidence: real screenshots from the LIVE console (vite dev server).
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = (n) => path.join(root, 'docs', n);
const URL0 = 'http://localhost:3000/ui/web/console/shell/index.html';

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
page.on('console', (m) => { if (m.type() === 'error') console.log('console-error:', m.text()); });

await page.goto(URL0, { waitUntil: 'load' });
await page.waitForSelector('.jx-sidebar');
await page.waitForTimeout(400); // backend probe settles

// P1 — shell at rest; sidebar items
const items = await page.$$eval('.jx-nav-item', (els) => els.map((e) => e.textContent.trim()));
console.log('P1 sidebar items:', JSON.stringify(items));
await page.screenshot({ path: OUT('phase24-scopeA-shell.png') });
console.log('shot: phase24-scopeA-shell.png');

// P2 — click each item, hash changes, shot each route
for (const [id, file] of [['chat', 'phase24-scopeA-chat-route.png'], ['settings', 'phase24-scopeA-settings-route.png'], ['graph', 'phase24-scopeA-graph-route.png']]) {
  await page.click('.jx-nav-item >> text=' + (id === 'graph' ? 'Work Graph' : id === 'chat' ? 'Chat' : 'Settings'));
  await page.waitForTimeout(200);
  const hash = await page.evaluate(() => window.location.hash);
  const route = await page.getAttribute('.jx-content', 'data-route');
  console.log('P2 click', id, '-> hash', hash, 'content[data-route]', route);
  await page.screenshot({ path: OUT(file) });
  console.log('shot:', file);
}

// P3 — header (model + backend dot) element shot
const headerTxt = await page.$eval('.jx-header', (e) => e.innerText.replace(/\n/g, ' | '));
console.log('P3 header text:', JSON.stringify(headerTxt));
const dotClass = await page.$eval('.jx-dot', (e) => e.className);
console.log('P3 backend dot class:', dotClass);
await page.locator('.jx-header').screenshot({ path: OUT('phase24-scopeA-header.png') });
console.log('shot: phase24-scopeA-header.png');

// P4 — token inspector (live computed :root vs spec)
await page.evaluate(() => { window.location.hash = '#/tokens'; });
await page.waitForSelector('.jx-inspector');
await page.waitForTimeout(200);
const verdict = await page.$eval('.jx-insp-verdict', (e) => e.textContent.trim());
console.log('P4 verdict:', verdict);
const fails = await page.$$eval('.jx-check.bad', (els) => els.length);
const rows = await page.$$eval('.jx-insp-table tbody tr', (trs) => trs.map((tr) => {
  const tds = tr.querySelectorAll('td');
  return tds[0].textContent + ' = ' + tds[1].textContent.trim() + ' (spec ' + tds[2].textContent + ') ' + tds[4].textContent;
}));
for (const r of rows) console.log('P4', r);
console.log('P4 FAIL count:', fails);
await page.screenshot({ path: OUT('phase24-scopeA-tokens-applied.png'), fullPage: true });
console.log('shot: phase24-scopeA-tokens-applied.png');

// P5 — keyboard: Tab cycles sidebar, Enter activates
await page.goto(URL0 + '#/chat', { waitUntil: 'load' });
await page.waitForSelector('.jx-sidebar');
await page.keyboard.press('Tab');
let focused1 = await page.evaluate(() => document.activeElement && document.activeElement.textContent.trim());
await page.keyboard.press('Tab');
let focused2 = await page.evaluate(() => document.activeElement && document.activeElement.textContent.trim());
await page.keyboard.press('Tab');
let focused3 = await page.evaluate(() => document.activeElement && document.activeElement.textContent.trim());
console.log('P5 Tab cycle:', JSON.stringify([focused1, focused2, focused3]));
await page.screenshot({ path: OUT('phase24-scopeA-tab-focus.png') });
console.log('shot: phase24-scopeA-tab-focus.png');
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
console.log('P5 Enter activates -> hash:', await page.evaluate(() => window.location.hash));

await browser.close();
console.log('DONE');

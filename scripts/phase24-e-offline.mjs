// Scope E — brain-off error states: composer offline banner + graph API unreachable
import { chromium } from 'playwright';
import path from 'path';
const OUT = (f) => path.join(process.cwd(), 'docs', f);
const URL_BASE = 'http://localhost:3000/ui/web/console/shell/index.html';
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page.goto(URL_BASE + '#/chat', { waitUntil: 'load' });
await page.waitForSelector('.p24-offline', { timeout: 20000 });
console.log('P7 offline banner:', await page.$eval('.p24-offline', (e) => e.textContent.trim()));
await page.screenshot({ path: OUT('phase24-scopeE-error-offline.png') });
await page.goto(URL_BASE + '#/graph', { waitUntil: 'load' });
await page.waitForSelector('[data-testid="graph-empty"]', { timeout: 20000 });
const t = await page.$eval('.p24-graph-empty-title', (e) => e.textContent.trim());
const sub = await page.$eval('.p24-graph-empty-sub', (e) => e.textContent.trim());
console.log('P7 graph API unreachable:', t, '|', sub);
await page.screenshot({ path: OUT('phase24-scopeE-error-graph-unreachable.png') });
await browser.close();
console.log('DONE (brain-off section)');

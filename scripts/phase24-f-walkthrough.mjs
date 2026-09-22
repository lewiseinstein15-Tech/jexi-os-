/**
 * Phase 24 Scope F — full walkthrough, ONE session, one browser context.
 * cold boot -> question -> streaming -> complete -> tool card -> (artifact) ->
 * settings -> graph -> mode switch -> (checkpoint)
 */
import { chromium } from 'playwright';
import path from 'path';

const OUT = (f) => path.join(process.cwd(), 'docs', f);
const URL_BASE = 'http://localhost:3000/ui/web/console/shell/index.html';
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
page.on('pageerror', (e) => console.log('PAGEERR:', String(e).slice(0, 200)));

/* P1 — cold boot */
await page.goto(URL_BASE + '#/chat', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.p24-composer', { timeout: 20000 });
const nav = await page.$$eval('.jx-nav-item', (els) => els.map((e) => e.textContent.trim()));
const active = await page.$eval('.jx-nav-item.is-active', (e) => e.textContent.trim());
const emptyVisible = !!(await page.$('.p24-empty'));
const backend = await page.$eval('.jx-backend-label', (e) => e.textContent.trim()).catch(() => 'n/a');
console.log('P1 sidebar:', JSON.stringify(nav), '| active:', active, '| clean state (empty transcript):', emptyVisible, '| backend:', backend);
await page.screenshot({ path: OUT('phase24-scopeF-walkthrough-1-cold-boot.png') });

/* P2 — type a real question */
const question = 'what does the scheduler do?';
await page.click('.p24-input');
await page.keyboard.type(question, { delay: 18 });
console.log('P2 typed:', JSON.stringify(await page.$eval('.p24-input', (e) => e.value)));
await page.screenshot({ path: OUT('phase24-scopeF-walkthrough-2-question-typed.png') });

/* P3 — send; capture stream start (narration row, before turn-end) */
await page.click('.p24-send');
await page.waitForSelector('.p24-narration', { timeout: 15000 });
const turnState = await page.$eval('.p24-meta-turn', (e) => e.textContent.trim()).catch(() => 'n/a');
await page.screenshot({ path: OUT('phase24-scopeF-walkthrough-3-answer-streaming.png') });
console.log('P3 stream started | narration rows:', await page.$$eval('.p24-narration', (r) => r.length), '| turn meta:', turnState);

/* P4 — turn completes */
await page.waitForSelector('.p24-turnend', { timeout: 20000 });
const narr = await page.$eval('.p24-narration', (e) => e.textContent.trim());
const turnend = await page.$eval('.p24-turnend', (e) => e.textContent.trim());
console.log('P4 narration row:', JSON.stringify(narr));
console.log('P4 turn-end row :', JSON.stringify(turnend));
await page.screenshot({ path: OUT('phase24-scopeF-walkthrough-4-answer-complete.png') });

/* P5 — tool card from the same turn */
await page.waitForSelector('.p24-toolcard', { timeout: 5000 });
const tool = await page.$eval('.p24-toolcard', (e) => e.textContent.trim().slice(0, 120));
console.log('P5 tool card:', JSON.stringify(tool));
await page.screenshot({ path: OUT('phase24-scopeF-walkthrough-5-tool-card.png') });

/* P6 — artifact panel: check wiring honestly */
const artifactSel = await page.$('[class*="artifact"], [data-testid*="artifact"]');
console.log('P6 artifact panel present:', !!artifactSel, '(chat/artifacts.js runtime module exists; Phase 24 chat surface has no artifact panel wiring)');

/* P7 — settings, provider section */
await page.goto(URL_BASE + '#/settings', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.p24-section', { timeout: 15000 });
const provider = await page.$eval('.p24-select', (e) => e.value);
const keyrefNone = !!(await page.$('.p24-keyref-none'));
console.log('P7 provider section visible | selected provider:', provider, '| keyRef configured:', !keyrefNone, '(unconfigured state shown honestly)');
await page.screenshot({ path: OUT('phase24-scopeF-walkthrough-7-settings-provider.png') });

/* P8 — graph */
await page.goto(URL_BASE + '#/graph', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.p24-gnode-card', { timeout: 20000 });
const counts = await page.$eval('[data-testid="graph-counts"]', (e) => e.textContent.trim());
console.log('P8 graph:', counts, '| mission:', await page.$eval('.p24-graph-select', (e) => e.value));
await page.screenshot({ path: OUT('phase24-scopeF-walkthrough-8-graph-nodes.png') });

/* P9 — mode switch: settings -> full -> chat -> tool event at new verbosity */
await page.goto(URL_BASE + '#/settings', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.p24-section', { timeout: 15000 });
await page.click('.p24-btn-group[aria-label="Display mode"] >> text=full');
const modesNow = await page.evaluate(async () => (await import('/ui/web/console/chat/runtime.js')).state('console-main').modes);
console.log('P9 modes after switch:', JSON.stringify(modesNow));
await page.click('.jx-nav-item >> text=Chat');
await page.waitForSelector('.p24-composer');
const longQ = 'write a detailed scheduler note: '.repeat(4) + 'Please explain the scheduler in detail. '.repeat(10) + 'Cover the cron event and condition triggers thoroughly so the tool arguments exceed six hundred characters for the verbosity check.';
await page.fill('.p24-input', longQ);
await page.click('.p24-send');
await page.waitForSelector('.p24-approval', { timeout: 10000 });
await page.click('.p24-approval >> text=approve');
await page.waitForSelector('.p24-toolcard.tool-use .p24-tool-body', { timeout: 15000 });
const body = await page.$eval('.p24-toolcard.tool-use .p24-tool-body', (e) => e.textContent);
console.log('P9 tool body at display=full:', body.length, 'chars | truncated?', body.includes('…'), '(default-verbosity state: walkthrough-5 tool card)');
await page.screenshot({ path: OUT('phase24-scopeF-walkthrough-9-mode-switch.png') });

/* P10 — checkpoint UI: check wiring honestly */
const cpSel = await page.$('[class*="checkpoint"], [data-testid*="checkpoint"], button:has-text("checkpoint")');
console.log('P10 checkpoint UI present:', !!cpSel, '(chat/checkpoints.js runtime module exists; Phase 24 chat surface has no checkpoint control wiring)');

await browser.close();
console.log('DONE walkthrough');

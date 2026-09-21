// phase-24(B) evidence: real rows from the Phase 16 runtime via the live console.
// Usage: node scripts/phase24-b-shots.mjs [main|offline]
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = (n) => path.join(root, 'docs', n);
const URL0 = 'http://localhost:3000/ui/web/console/shell/index.html#/chat';
const mode = process.argv[2] || 'main';

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
page.on('console', (m) => { if (m.type() === 'error') console.log('console-error:', m.text()); });

await page.goto(URL0, { waitUntil: 'load' });
await page.waitForSelector('.p24-composer');

if (mode === 'offline') {
  await page.waitForSelector('.p24-offline', { timeout: 15000 });
  await page.screenshot({ path: OUT('phase24-scopeB-chat-backend-offline.png') });
  console.log('shot: phase24-scopeB-chat-backend-offline.png');
  await browser.close();
  console.log('DONE offline');
  process.exit(0);
}

// P1 — empty composer at rest
await page.waitForTimeout(600); // backend probe
await page.screenshot({ path: OUT('phase24-scopeB-chat-empty.png') });
console.log('P1 shot: chat-empty');

// P2 — typing, then send; first narration row; stream; answer
await page.fill('.p24-input', 'what does the scheduler do?');
await page.screenshot({ path: OUT('phase24-scopeB-chat-typing.png') });
console.log('P2 shot: chat-typing');
await page.click('.p24-send');
await page.waitForSelector('.p24-narration', { timeout: 10000 });
const firstRow = await page.$eval('.p24-narration .p24-row-text', (e) => e.textContent);
console.log('P2 first narration row:', JSON.stringify(firstRow));
await page.screenshot({ path: OUT('phase24-scopeB-chat-streaming.png') });
console.log('P2 shot: chat-streaming');
await page.waitForSelector('.p24-turnend', { timeout: 10000 });
const turnEnd = await page.$eval('.p24-turnend .p24-row-text', (e) => e.textContent);
console.log('P2 turn-end row:', JSON.stringify(turnEnd));
await page.screenshot({ path: OUT('phase24-scopeB-chat-answer.png') });
console.log('P2 shot: chat-answer');

// P3 — tool card from the real tool.started/tool.completed events
const toolCards = await page.$$eval('.p24-toolcard', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
console.log('P3 tool cards:', JSON.stringify(toolCards));
await page.locator('.p24-transcript').screenshot({ path: OUT('phase24-scopeB-chat-toolcard.png') });
console.log('P3 shot: chat-toolcard (transcript region)');

// P4 — plan mode refusal on a write intent
await page.click('.p24-mode-btn >> text=plan');
await page.waitForTimeout(300);
const modesNow = await page.$eval('.p24-meta-modes', (e) => e.textContent);
console.log('P4 modes after switch:', JSON.stringify(modesNow));
await page.fill('.p24-input', 'write a deploy script now');
await page.click('.p24-send');
// destructive tool in plan mode -> approval.requested first; approve it, then
// the Scope H plan gate refuses the tool (E_PLAN_MODE_READONLY).
await page.waitForSelector('.p24-approve', { timeout: 10000 });
const approvalRow = await page.$eval('.p24-approval .p24-row-text', (e) => e.textContent);
console.log('P4 approval row:', JSON.stringify(approvalRow));
await page.click('.p24-approve');
await page.waitForSelector('.p24-refused', { timeout: 10000 });
const refused = await page.$eval('.p24-refused .p24-row-text', (e) => e.textContent);
console.log('P4 refused row:', JSON.stringify(refused));
await page.screenshot({ path: OUT('phase24-scopeB-chat-refused.png') });
console.log('P4 shot: chat-refused');

await browser.close();
console.log('DONE main');

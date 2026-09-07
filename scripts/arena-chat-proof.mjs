/** ARENA ASTRA — real conversation proof: type + send like a user, capture the answer. */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
const OUT = path.resolve('docs/screenshots');
const UI = 'http://127.0.0.1:4173';
const BRAIN = 'http://127.0.0.1:3002';
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript((b) => localStorage.setItem('jexi_backend_url', b), BRAIN);
  const page = await ctx.newPage();
  await page.goto(UI, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.jx-app', { timeout: 25000 });
  await page.waitForTimeout(1500);
  const box = page.locator('textarea.jx-input').first();
  await box.waitFor({ timeout: 10000 });
  await box.click();
  await page.keyboard.type('hello', { delay: 40 });
  await page.waitForTimeout(400);
  await page.keyboard.press('Enter');
  // wait for JEXI's reply bubble (user msg + at least one jexi text)
  await page.waitForTimeout(14000);
  const session = await page.context().newCDPSession(page);
  const { data } = await session.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(path.join(OUT, 'arena-desktop-chat.png'), Buffer.from(data, 'base64'));
  await session.detach();
  const texts = await page.$$eval('.jx-hand, .whitespace-pre-wrap', (els) => els.map((e) => e.innerText.slice(0, 200)));
  console.log('CHAT TEXTS:', JSON.stringify(texts.slice(0, 6)));
  console.log('saved arena-desktop-chat.png');
} finally { await browser.close(); }

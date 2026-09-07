// ARENA TRACE PROOF — live agent-transcript verification (real task, real browser).
// Sends "research the latest AI news", waits for the turn to finish, then asserts
// the StepRow/Narration transcript contract against the live DOM and screenshots it.
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const SHOT = (...p) => path.join(__dir, '..', 'docs', 'screenshots', ...p);
const UI = process.env.ARENA_UI || 'http://127.0.0.1:4173';
const BACKEND = process.env.ARENA_BACKEND || 'http://127.0.0.1:3002';
const QUERY = 'research the latest AI news';

let fails = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) fails++;
};

const browser = await chromium.launch();

// ---------- DESKTOP: run a real task, verify the live transcript ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript((be) => localStorage.setItem('jexi_backend_url', be), BACKEND);
  const page = await ctx.newPage();
  const shots = await page.context().newCDPSession(page);
  const snap = async (name) => {
    const { data } = await shots.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(SHOT(name), Buffer.from(data, 'base64'));
    console.log('saved', name);
  };
  await page.goto(UI, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.jx-app', { timeout: 25000 });
  await page.waitForTimeout(1200);

  check('old agent card component is GONE from the DOM', (await page.$$('.jx-jbub')).length === 0);

  const box = page.locator('.jx-composer textarea, textarea[placeholder*="JEXI"], textarea').first();
  await box.click();
  await page.keyboard.type(QUERY, { delay: 12 });
  await page.keyboard.press('Enter');

  // wait for the turn to start, then finish (idle placeholder returns)
  await page.waitForFunction(
    () => !!document.querySelector('textarea[placeholder*="next message"]'),
    null, { timeout: 30000 }).catch(() => {});
  await page.waitForFunction(
    () => !!document.querySelector('textarea[placeholder="Type a message to JEXI..."]'),
    null, { timeout: 280000 });

  const dom = await page.evaluate(() => {
    const cs = (el) => { const c = getComputedStyle(el); return { bg: c.backgroundColor, bw: c.borderTopWidth, bs: c.borderTopStyle, sh: c.boxShadow, ff: c.fontFamily }; };
    const tx = document.querySelector('.jx-transcript');
    const narr = document.querySelector('.jx-narr');
    const lab = document.querySelector('.jx-step-label');
    return {
      steps: document.querySelectorAll('.jx-step').length,
      narrs: document.querySelectorAll('.jx-narr').length,
      ububs: document.querySelectorAll('.jx-ubub').length,
      jbubs: document.querySelectorAll('.jx-jbub').length,
      chevs: document.querySelectorAll('.jx-step-chev').length,
      tx: tx ? cs(tx) : null,
      narrFF: narr ? getComputedStyle(narr).fontFamily : '',
      labFF: lab ? getComputedStyle(lab).fontFamily : '',
      stepSample: document.querySelector('.jx-step-label')?.textContent?.slice(0, 80) || '',
      allLabels: [...document.querySelectorAll('.jx-step-label')].map((el) => el.textContent),
    };
  });

  check('user bubble still rendered', dom.ububs > 0, `${dom.ububs} user bubble(s)`);
  check('agent card fully gone', dom.jbubs === 0);
  check('tool calls render as step rows', dom.steps > 0, `${dom.steps} row(s): "${dom.stepSample}"`);
  console.log('STEP LABELS:', JSON.stringify(dom.allLabels));
  check('repeated actions group into one summary row', dom.allLabels.some((l) => /^(Ran \d+|Explored \d+|Edited \d+)/.test(l)), 'fold check');
  check('every step row has an expand chevron', dom.chevs >= dom.steps && dom.steps > 0, `${dom.chevs} chevron(s)`);
  check('narration paragraphs present', dom.narrs > 0, `${dom.narrs} narration(s)`);
  if (dom.tx) {
    const flat = (dom.tx.bg === 'rgba(0, 0, 0, 0)' || dom.tx.bg === 'transparent') && (dom.tx.bw === '0px' || dom.tx.bs === 'none') && dom.tx.sh === 'none';
    check('transcript has zero bg/border/shadow (prints on page)', flat, JSON.stringify(dom.tx));
  } else check('transcript container exists', false);
  check('narration uses the app handwriting face', /Caveat/i.test(dom.narrFF), dom.narrFF);
  check('step labels use the app handwriting face', /Caveat/i.test(dom.labFF), dom.labFF);

  // expand the first row — raw command + output must reveal (JS click:
  // the row can sit under the sticky composer in the scrolled container,
  // which blocks Playwright's actionability checks but not a real tap —
  // the React onClick path exercised is identical).
  const first = page.locator('.jx-step-line').first();
  if (await first.count()) {
    await first.evaluate((el) => el.click());
    await page.waitForTimeout(400);
    const det = await page.locator('.jx-step-detail').first().count();
    check('chevron expands raw command + output', det > 0);
  }
  await snap('arena-desktop-trace.png');
  await ctx.close();
}

// ---------- PHONE: transcript holds on small screens ----------
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await ctx.addInitScript((be) => localStorage.setItem('jexi_backend_url', be), BACKEND);
  const page = await ctx.newPage();
  await page.goto(UI, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.jx-app', { timeout: 25000 });
  await page.waitForTimeout(1000);
  const box = page.locator('textarea').first();
  await box.click();
  await page.keyboard.type('hello', { delay: 10 });
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    () => !!document.querySelector('textarea[placeholder="Type a message to JEXI..."]'),
    null, { timeout: 180000 });
  const n = await page.evaluate(() => ({
    tx: document.querySelectorAll('.jx-transcript').length,
    jbub: document.querySelectorAll('.jx-jbub').length,
    ubub: document.querySelectorAll('.jx-ubub').length,
  }));
  check('phone: flat transcript, no card', n.tx > 0 && n.jbub === 0, JSON.stringify(n));
  const shots = await page.context().newCDPSession(page);
  const { data } = await shots.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(SHOT('arena-phone-trace.png'), Buffer.from(data, 'base64'));
  console.log('saved arena-phone-trace.png');
  await ctx.close();
}

await browser.close();
console.log(fails ? `\nTRACE-PROOF: ${fails} FAILURE(S)` : '\nTRACE-PROOF: ALL GREEN');
process.exit(fails ? 1 : 0);

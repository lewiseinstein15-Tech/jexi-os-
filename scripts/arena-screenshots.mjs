/**
 * ARENA Phase 6 — REAL screenshots of the running app (spec Part 38).
 * Launches the built UI against the live local brain, drives it like a user,
 * and saves PNGs to docs/screenshots/. No mocks, no composites.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('docs/screenshots');
fs.mkdirSync(OUT, { recursive: true });
const UI = 'http://127.0.0.1:4173';
const BRAIN = 'http://127.0.0.1:3002';

const results = [];

async function newPage(browser, { width, height, mobile = false }) {
  const context = await browser.newContext({
    viewport: { width, height },
    isMobile: mobile,
    hasTouch: mobile,
    deviceScaleFactor: 2,
  });
  await context.addInitScript((brain) => {
    localStorage.setItem('jexi_backend_url', brain);
  }, BRAIN);
  const page = await context.newPage();
  return { context, page };
}


/* CDP capture: framer-motion paints every frame (rAF), so Playwright's
   stability wait never settles. A raw CDP capture takes the frame as-is. */
async function cdpShot(page, file) {
  const session = await page.context().newCDPSession(page);
  const { data } = await session.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
  await session.detach();
}

async function boot(page, label) {
  await page.goto(UI, { waitUntil: 'domcontentloaded' });
  // BootSplash: min 1.4s, hard cap 15s. Wait for the app shell.
  await page.waitForSelector('.jx-app', { timeout: 25_000 });
  await page.waitForTimeout(1200); // let widgets/status settle
  console.log(`booted: ${label}`);
}

const browser = await chromium.launch();

try {
  /* ── DESKTOP 1440×900 ─────────────────────────────────────────────── */
  {
    const { context, page } = await newPage(browser, { width: 1440, height: 900 });
    await boot(page, 'desktop');

    // 1. HOME — conversation hero + left rail
    await cdpShot(page, path.join(OUT, 'arena-desktop-home.png'));
    results.push('arena-desktop-home.png');

    // rail items visible?
    const rail = await page.$$eval('.jx-menu .jx-mi', (els) => els.map((e) => e.textContent.trim()));
    console.log('rail items:', JSON.stringify(rail));
    const burgerHidden = await page.$eval('.jx-burger', (el) => getComputedStyle(el).display === 'none');
    console.log('desktop burger hidden (rail is the nav):', burgerHidden);

    // 2. real chat exchange through the live brain (fast path — one small call).
    // React controlled input: set value via the native setter + dispatch input,
    // then submit with Enter (Playwright's fill fights the rAF render loop).
    const typed = await page.evaluate(() => {
      const ta = document.querySelector('textarea.jx-input');
      if (!ta) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, 'hello');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    });
    if (typed) {
      await page.keyboard.press('Enter');
      // wait for JEXI's answer (fast path answers in a few seconds)
      await page.waitForTimeout(12000);
      await cdpShot(page, path.join(OUT, 'arena-desktop-chat.png'));
      results.push('arena-desktop-chat.png');
    }

    // 3–5. the real screens
    for (const [name, label] of [['missions', 'Missions'], ['memory', 'Memory'], ['tools', 'Tools']]) {
      const btn = page.locator(`.jx-menu .jx-mi`, { hasText: label }).first();
      if (await btn.count()) {
        await btn.click();
        await page.waitForTimeout(1500);
        await page.screenshot({ path: path.join(OUT, `arena-desktop-${name}.png`), fullPage: false, animations: 'disabled' });
        results.push(`arena-desktop-${name}.png`);
      } else {
        console.log(`MISSING rail button: ${label}`);
      }
    }
    await context.close();
  }

  /* ── PHONE 390×844 ────────────────────────────────────────────────── */
  {
    const { context, page } = await newPage(browser, { width: 390, height: 844, mobile: true });
    await boot(page, 'phone');

    // 6. phone home: hamburger top, NO bottom nav
    await cdpShot(page, path.join(OUT, 'arena-phone-home.png'));
    results.push('arena-phone-home.png');
    const burgerVisible = await page.$eval('.jx-burger', (el) => getComputedStyle(el).display !== 'none');
    console.log('phone burger visible:', burgerVisible);

    // 7. drawer open
    await page.click('.jx-burger');
    await page.waitForTimeout(600);
    await cdpShot(page, path.join(OUT, 'arena-phone-drawer.png'));
    results.push('arena-phone-drawer.png');
    const drawerItems = await page.$$eval('.jx-menu.open .jx-mi', (els) => els.map((e) => e.textContent.trim()));
    console.log('drawer items:', JSON.stringify(drawerItems));

    await context.close();
  }

  console.log('SCREENSHOTS SAVED:', JSON.stringify(results, null, 1));
} finally {
  await browser.close();
}

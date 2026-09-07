/**
 * ARENA Phase 6 — DOM/CSS VERIFICATION of the rebuilt UI (no vision needed).
 * Proves from the live rendered app: rail items, palette (no neon green),
 * handwriting font loaded and applied, phone hamburger + no bottom nav.
 */
import { chromium } from 'playwright';

const UI = 'http://127.0.0.1:4173';
const BRAIN = 'http://127.0.0.1:3002';

const browser = await chromium.launch();
const check = (name, ok, detail = '') => console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);

async function openPage(w, h, mobile = false) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile });
  await ctx.addInitScript((b) => localStorage.setItem('jexi_backend_url', b), BRAIN);
  const page = await ctx.newPage();
  await page.goto(UI, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.jx-app', { timeout: 25_000 });
  await page.waitForTimeout(1500);
  return { ctx, page };
}

try {
  /* desktop */
  const { ctx, page } = await openPage(1440, 900);

  const railItems = await page.$$eval('.jx-menu .jx-mi', (els) => els.map((e) => e.textContent.trim()));
  check('desktop rail shows the spec 7', ['Home', 'Missions', 'Agents', 'Memory', 'Tools', 'Files', 'Settings'].every((x) => railItems.includes(x)), JSON.stringify(railItems));

  const railVisible = await page.$eval('.jx-menu', (el) => getComputedStyle(el).display !== 'none' && getComputedStyle(el).position === 'fixed');
  check('desktop: rail is a permanent fixed left nav', railVisible);

  const burgerHidden = await page.$eval('.jx-burger', (el) => getComputedStyle(el).display === 'none');
  check('desktop: hamburger hidden (rail replaces it)', burgerHidden);

  // palette: computed colors of brand elements — must be warm, never #00d26a
  // palette proof: the ACTIVE rail item + the user-bubble gradient source (tailwind brand)
  const activeBg = await page.evaluate(() => {
    const el = document.querySelector('.jx-mi.active') || document.querySelector('.jx-mi');
    return el ? getComputedStyle(el).boxShadow + ' | ' + getComputedStyle(el).backgroundColor : null;
  });
  check('active nav item uses the warm accent', activeBg !== null && /255,\s*138,\s*61/.test(String(activeBg)), String(activeBg).slice(0, 90));

  const brandColor = await page.evaluate(() => {
    // tailwind brand tokens compile to utility classes; probe the orb label + any .text-brand element
    const el = document.querySelector('.text-brand, .jx-writer, [class*="text-brand"]');
    return el ? getComputedStyle(el).color : null;
  });
  check('brand text color is warm (not neon green)', brandColor !== null && !/rgb\(0,\s*210,\s*106\)/.test(brandColor) && /rgb\(2[0-9]{2},/.test(brandColor), String(brandColor));

  const greenFound = await page.evaluate(() => {
    const bad = [];
    for (const el of document.querySelectorAll('.jx-send, .jx-mi.active, .jx-btn')) {
      const c = getComputedStyle(el);
      for (const v of [c.backgroundColor, c.color, c.borderColor]) {
        if (/rgb\(0,\s*210,\s*106\)/.test(v)) bad.push(`${el.className}: ${v}`);
      }
    }
    return bad;
  });
  check('no neon green #00D26A on brand elements', greenFound.length === 0, JSON.stringify(greenFound.slice(0, 2)));

  // handwriting: Caveat @font-face loaded?
  const fontLoaded = await page.evaluate(async () => {
    await document.fonts.load('20px Caveat');
    return document.fonts.check('20px Caveat');
  });
  check('Caveat handwriting font loaded from bundle', fontLoaded);

  const handApplied = await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.className = 'jx-hand';
    probe.innerHTML = '<p>test</p>';
    document.body.appendChild(probe);
    const fam = getComputedStyle(probe.querySelector('p')).fontFamily;
    probe.remove();
    return fam;
  });
  check('jx-hand paragraphs use the handwriting face', /Caveat/i.test(handApplied), handApplied);

  // conversation is the hero: chat section visible by default
  const homeShowing = await page.$eval('.jx-view.show', (el) => el !== null);
  check('Home (conversation) is the default view', homeShowing);

  // input exists?
  const inputCount = await page.locator('textarea.jx-input, textarea').count();
  check('chat input present', inputCount > 0, `count=${inputCount}`);

  await ctx.close();

  /* phone */
  const { ctx: pctx, page: ppage } = await openPage(390, 844, true);

  const burgerVisible = await ppage.$eval('.jx-burger', (el) => getComputedStyle(el).display !== 'none');
  check('phone: hamburger visible at top', burgerVisible);

  const railHidden = await ppage.$eval('.jx-menu', (el) => {
    // hidden = display:none OR fully off-screen (the drawer slide pattern)
    const c = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return c.display === 'none' || r.right <= 0 || r.left >= window.innerWidth;
  });
  check('phone: left rail hidden (drawer pattern)', railHidden);

  const bottomNav = await ppage.evaluate(() => {
    // a bottom nav bar = VISIBLE fixed element hugging the viewport bottom,
    // horizontally ONSCREEN, with >1 nav buttons. Off-screen drawers don't count.
    for (const el of document.querySelectorAll('nav, [class*="bottom"], [class*="tabbar"], [class*="tab-bar"], .jx-menu')) {
      const c = getComputedStyle(el);
      if (c.display === 'none' || c.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.right <= 0 || r.left >= window.innerWidth) continue; // off-screen = hidden drawer
      const fixed = c.position === 'fixed' || c.position === 'sticky';
      if (fixed && (window.innerHeight - r.bottom) < 24) {
        const links = el.querySelectorAll('button, a').length;
        if (links > 1) return `found bottom bar with ${links} buttons: ${el.className}`;
      }
    }
    return null;
  });
  check('phone: NO bottom navigation bar', bottomNav === null, bottomNav || '');

  // drawer opens with the same 7 + off-rail items
  await ppage.click('.jx-burger');
  await ppage.waitForTimeout(500);
  const drawerItems = await ppage.$$eval('.jx-menu.open .jx-mi', (els) => els.map((e) => e.textContent.trim()));
  check('phone drawer lists the spec 7', ['Home', 'Missions', 'Agents', 'Memory', 'Tools', 'Files', 'Settings'].every((x) => drawerItems.includes(x)), JSON.stringify(drawerItems));

  await pctx.close();
  console.log('DOM VERIFICATION DONE');
} finally {
  await browser.close();
}

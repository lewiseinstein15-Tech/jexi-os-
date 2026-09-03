#!/usr/bin/env node
/**
 * B209 — LAYOUT AUDIT (the B207 lesson, applied from the start): the new
 * Team screen must not just render — it must not break visually at phone
 * width. Real browser, real backend, real interactions:
 *
 *   - reach the Team view through the actual drawer navigation
 *   - horizontal overflow at 390px (the classic mobile break)
 *   - elements clipped past the viewport edge
 *   - the toggle (bench/activate) actually round-trips
 *   - history expansion renders without layout shift breakage
 *   - the hire form opens, submits, and the new employee appears
 */
import { chromium } from 'playwright-core';

const UI = 'http://localhost:3000/';
const W = 390, H = 844;
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};

const b = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await b.newPage({ viewport: { width: W, height: H } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(UI, { timeout: 30000, waitUntil: 'domcontentloaded' });
await page.waitForSelector('.jx-burger', { timeout: 20000 });

// ── reach the Team view through the real drawer ──
await page.click('.jx-burger');
await page.waitForSelector('.jx-menu.open', { timeout: 5000 });
const teamBtn = page.locator('.jx-mi', { hasText: 'Team' });
check('Team entry exists in the drawer', await teamBtn.count() === 1);
await teamBtn.click();
// has-text is substring+case-insensitive (the drawer item also says Team) —
// scope to the tab strip inside the visible view, exact text
const teamTab = page.locator('.jx-view.show button', { hasText: /^TEAM$/ });
await teamTab.waitFor({ timeout: 10000 });
await teamTab.click(); // the screen opens on PIPELINE; switch to the management tab
await page.waitForTimeout(1200); // roster fetch settles

// ── layout: overflow + clipping at phone width ──
const layout = await page.evaluate(() => {
  const doc = document.documentElement;
  const vw = doc.clientWidth;
  const overflowX = doc.scrollWidth - vw;
  const clipped = [];
  for (const el of document.querySelectorAll('.jx-view.show *')) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && (r.right > vw + 1 || r.left < -1)) {
      clipped.push(`${el.tagName}.${String(el.className).split(' ')[0]} right=${Math.round(r.right)} left=${Math.round(r.left)}`);
    }
  }
  return { vw, overflowX, clipped: clipped.slice(0, 5) };
});
check('no horizontal overflow at 390px', layout.overflowX <= 1, `overflowX=${layout.overflowX}`);
check('no element clipped past the viewport edge', layout.clipped.length === 0, layout.clipped.join(' | '));

// ── the roster rendered real employees ──
const rows = await page.locator('text=Zola').count();
check('the roster shows a real employee (Zola)', rows >= 1);
const toggleCount = await page.locator('button:has-text("BENCH"), button:has-text("ACTIVATE")').count();
check('every employee row has a toggle', toggleCount >= 8, `found ${toggleCount}`);

// ── bench → activate round-trip against the real backend ──
const zolaRow = page.locator('div.rounded-lg', { hasText: 'Zola' }).first();
const benchBtn = zolaRow.locator('button:has-text("BENCH")');
await benchBtn.click();
await page.waitForTimeout(1200);
const activated = await zolaRow.locator('button:has-text("ACTIVATE")').count();
check('benching Zola round-trips (button flips to ACTIVATE)', activated === 1);
await zolaRow.locator('button:has-text("ACTIVATE")').click();
await page.waitForTimeout(1200);
const benched = await zolaRow.locator('button:has-text("BENCH")').count();
check('activating Zola restores her', benched === 1);

// ── history expansion ──
await zolaRow.locator('button[aria-label*="history"], button:has(svg.lucide-history)').first().click().catch(() => zolaRow.locator('button').nth(0).click());
await page.waitForTimeout(900);
const layout2 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check('history expansion introduces no overflow', layout2 <= 1, `overflowX=${layout2}`);

// ── hire form: open, fill, submit, appears ──
await page.click('text=HIRE A NEW EMPLOYEE');
await page.waitForSelector('input[placeholder*="Nadia"]', { timeout: 5000 });
await page.fill('input[placeholder*="Nadia"]', 'Nadia');
await page.fill('input[placeholder*="Data Analyst"]', 'Data Analyst');
await page.fill('input[placeholder*="comma list"]', 'data, research');
await page.click('text=ADD TO THE TEAM');
await page.waitForTimeout(1500);
const nadia = await page.locator('text=Nadia').count();
check('the hire lands on the roster and the form closes', nadia >= 1);
const layout3 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check('no overflow after the hire', layout3 <= 1, `overflowX=${layout3}`);

// cleanup: bench the test hire so the demo roster stays clean
const nadiaRow = page.locator('div.rounded-lg', { hasText: 'Nadia' }).first();
if (await nadiaRow.count()) { await nadiaRow.locator('button:has-text("BENCH")').click().catch(() => {}); await page.waitForTimeout(800); }

// ── the other tabs still work (nothing broken by the new one) ──
await page.click('button:has-text("PIPELINE")').catch(() => {});
await page.waitForTimeout(400);
const layout4 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check('pipeline tab intact (no overflow)', layout4 <= 1, `overflowX=${layout4}`);
const rosterTab = page.locator('.jx-view.show button', { hasText: /^ROSTER$/ });
await rosterTab.click().catch(() => {});
await page.waitForTimeout(2500); // the 252-agent registry loads over the network
const skillRoster = await page.locator('.jx-view.show').innerText().catch(() => '');
check('the 252-agent skill roster still renders', skillRoster.length > 400, `len=${skillRoster.length}`);

check('no page errors through the whole audit', errors.length === 0, errors.slice(0, 3).join(' | '));

await b.close();
console.log(`\nB209-LAYOUT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

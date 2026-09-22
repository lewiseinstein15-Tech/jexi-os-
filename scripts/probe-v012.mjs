#!/usr/bin/env node
/* probe-v012.mjs — full-stack UI gate for the agent-run timeline.
   Drives the BUILT console (vite preview, started separately) against the
   REAL brain at two viewports, and asserts the v0.12 contract:
     BRAIN TASKS strip · PLAN card (auto-DONE) · thinking card ·
     tool cards (tap-expand) · ANSWERED·Ns pill · no overflow · no pageerrors
   Usage:  node scripts/probe-v012.mjs
   Env:    PROBE_URL (default http://127.0.0.1:4179)
   Exit 0 = all checks pass · exit 1 = DO NOT SHIP */
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const URL_BASE = process.env.PROBE_URL || 'http://127.0.0.1:4179';
// consolidation cleanup: screenshots + result JSON go to os.tmpdir()
// (was the hardcoded sandbox path /home/z/my-project/download).
const SHOTS = path.join(os.tmpdir(), 'probe-v012-shots');
const RESULTS = path.join(os.tmpdir(), 'probe-v012-results');
mkdirSync(SHOTS, { recursive: true });
mkdirSync(RESULTS, { recursive: true });

const VIEWPORTS = [
  { label: 'desktop', width: 1440, height: 900, shot: `${SHOTS}/v012-desktop-chat.png` },
  { label: 'phone', width: 390, height: 844, shot: `${SHOTS}/v012-phone-chat.png` },
];

const results = [];
let fails = 0;
const ok = (name, detail) => { results.push(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`); };
const bad = (name, detail) => { results.push(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); fails += 1; };

const countAnswered = (page) => page.evaluate(() => Array.from(document.querySelectorAll('.chatlog .pill.ok')).filter((p) => /ANSWERED/.test(p.textContent)).length);

async function runViewport(vp, tok) {
  console.log(`\n—— ${vp.label} · ${vp.width}×${vp.height} ——`);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e && e.message || e)));

  try {
    await page.goto(URL_BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // boot: BootScreen wakes the brain, runs the self-test, hands over to chat
    await page.waitForSelector('.jcx .chatwrap', { timeout: 300000, polling: 2000 });
    console.log('  boot handover complete (console live)');

    // boot self-test replay should answer on its own
    let selfTest = 'answered';
    try {
      await page.waitForFunction(
        () => Array.from(document.querySelectorAll('.chatlog .pill.ok')).some((p) => /ANSWERED/.test(p.textContent)),
        { timeout: 300000, polling: 2000 },
      );
      console.log('  boot self-test replay ANSWERED');
    } catch { selfTest = 'no-answer (continuing)'; console.log('  ! self-test replay did not answer in time — continuing'); }

    // unique, un-cacheable question — fresh math forces the FULL pipeline
    // (interpreter → plan → think → tools → answer); generic questions hit the
    // brain's memory fast-path ("serving it directly", answered in 0.9s)
    const a = 137 + Math.floor(Math.random() * 800);
    const b = 3 + Math.floor(Math.random() * 6);
    const c = 17 + Math.floor(Math.random() * 80);
    const q = `Probe ${tok}-${vp.label}: plan the steps and think it through visibly, then compute exactly ${a} * ${b} + ${c} and give the final number.`;
    const beforeOk = await countAnswered(page);
    await page.fill('.composer .hin', q);
    await page.click('.composer .send');
    console.log(`  dispatched: "${q.slice(0, 58)}…"`);
    await page.waitForFunction(
      (n) => Array.from(document.querySelectorAll('.chatlog .pill.ok')).filter((p) => /ANSWERED/.test(p.textContent)).length > n,
      beforeOk, { timeout: 300000, polling: 2000 },
    );
    console.log('  run ANSWERED — asserting the v0.12 contract');

    // settle, then assert
    await page.waitForTimeout(1200);
    const r = await page.evaluate(() => {
      const $ = (s) => document.querySelector(s);
      const $$ = (s) => Array.from(document.querySelectorAll(s));
      const strip = $('.taskstrip');
      const plans = $$('.plancard');
      const lastPlan = plans[plans.length - 1];
      const thinks = $$('.thinkbar');
      const lastThink = thinks[thinks.length - 1];
      const cards = $$('.tcard');
      const answered = $$('.chatlog .pill.ok').filter((p) => /ANSWERED/.test(p.textContent));
      const chatlog = $('.chatlog');
      return {
        strip: !!strip && /BRAIN TASKS/.test(strip.textContent),
        stripText: strip ? strip.querySelector('.tshead').textContent.trim() : '(absent)',
        planCount: plans.length,
        planDone: !!lastPlan && /DONE/.test(lastPlan.textContent),
        planRows: lastPlan ? lastPlan.querySelectorAll('.prow').length : 0,
        thinkCount: thinks.length,
        thinkLen: lastThink && lastThink.querySelector('.tbody') ? lastThink.querySelector('.tbody').textContent.length : 0,
        toolCards: cards.length,
        narr: $$('.cnarr').length,
        sources: $$('.srcc .sc').length,
        answeredPill: answered.length ? answered[answered.length - 1].textContent.trim().replace(/\s+/g, ' ') : '',
        docOverflow: document.documentElement.scrollWidth - window.innerWidth,
        chatOverflow: chatlog ? chatlog.scrollWidth - chatlog.clientWidth : 999,
        chatLogScroll: chatlog ? `${Math.round(chatlog.scrollTop)}/${chatlog.scrollHeight}` : '',
      };
    });

    r.strip ? ok('BRAIN TASKS strip (real /api/context)', r.stripText) : bad('BRAIN TASKS strip', r.stripText);
    r.planCount > 0 ? ok('PLAN card rendered', `${r.planCount} plan(s)`) : bad('PLAN card missing');
    r.planDone ? ok('PLAN auto-DONE after run', `${r.planRows} step row(s)`) : bad('PLAN never reached DONE');
    r.thinkCount > 0 ? ok('thinking card (think deltas captured)', `${r.thinkLen} chars`) : bad('thinking card missing');
    r.toolCards >= 3 ? ok('tool cards (pipeline logs)', `${r.toolCards} card(s)`) : bad('too few tool cards', String(r.toolCards));
    /ANSWERED · \d+S/.test(r.answeredPill) ? ok('ANSWERED · Ns timed pill', r.answeredPill) : bad('pill malformed', r.answeredPill || '(none)');
    r.narr > 0 ? ok('narration paragraphs', `${r.narr}`) : results.push('  · narration (optional) — 0 this run');
    r.sources > 0 ? ok('source chips', `${r.sources}`) : results.push('  · sources (optional) — 0 this run');
    r.docOverflow <= 1 ? ok('no document horizontal overflow', `${r.docOverflow}px`) : bad('document overflows horizontally', `${r.docOverflow}px`);
    r.chatOverflow <= 1 ? ok('no chatlog horizontal overflow', `${r.chatOverflow}px`) : bad('chatlog overflows horizontally', `${r.chatOverflow}px`);

    // tap-expand: first tool card opens on tap
    const card = page.locator('.tcard').first();
    const beforeOpen = await card.evaluate((el) => el.open);
    await card.locator('summary').click();
    await page.waitForTimeout(200);
    const afterOpen = await card.evaluate((el) => el.open);
    !beforeOpen && afterOpen ? ok('tool card tap-expand') : bad('tool card tap-expand', `before=${beforeOpen} after=${afterOpen}`);

    // phone-only: hamburger drawer must exist and open
    if (vp.label === 'phone') {
      const burger = page.locator('.hudburger');
      const burgerVis = await burger.isVisible();
      if (burgerVis) {
        await burger.click();
        await page.waitForTimeout(450);
        const drawer = await page.evaluate(() => {
          const a = document.querySelector('.jcx aside');
          return a && a.classList.contains('open');
        });
        drawer ? ok('phone drawer opens from hamburger') : bad('phone drawer did not open');
        // close by tapping the backdrop OUTSIDE the drawer (its center is covered by the aside)
        await page.mouse.click(vp.width - 30, 120);
        await page.waitForTimeout(500);
        const closed = await page.evaluate(() => {
          const a2 = document.querySelector('.jcx aside');
          return a2 && !a2.classList.contains('open');
        });
        closed ? ok('phone drawer closes from backdrop tap') : bad('phone drawer did not close');
      } else bad('hamburger not visible on phone');
    }

    pageErrors.length === 0 ? ok('zero page errors') : bad('page errors', pageErrors.slice(0, 3).join(' | '));
    await page.screenshot({ path: vp.shot, fullPage: false });
    console.log(`  screenshot → ${vp.shot}`);
    writeFileSync(path.join(RESULTS, `probe-${vp.label}-result.json`), JSON.stringify({ vp: vp.label, selfTest, ...r, pageErrors }, null, 2));
  } catch (e) {
    bad(`${vp.label} probe crashed`, String(e && e.message || e).slice(0, 200));
    try { await page.screenshot({ path: vp.shot.replace('.png', '-CRASH.png'), fullPage: false }); } catch { /* ignore */ }
  } finally {
    await browser.close();
  }
}

const tok = Date.now().toString(36);
for (const vp of VIEWPORTS) await runViewport(vp, tok);

console.log(`\n${'—'.repeat(64)}\nPROBE v0.12 — ${fails === 0 ? 'ALL CHECKS PASS' : `${fails} CHECK(S) FAILED`}`);
for (const l of results) console.log(l);
process.exit(fails === 0 ? 0 : 1);

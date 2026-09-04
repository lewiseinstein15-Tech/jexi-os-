#!/usr/bin/env node
/**
 * B207 — LAYOUT AUDIT: measure the thinking panel's VISUAL behavior in a
 * real browser at phone width, while she is actually thinking. The DOM
 * checks in B206c proved "no crash" — this proves "no visual break":
 *
 *   - horizontal overflow (page wider than viewport → sideways scroll =
 *     broken layout, the classic mobile break)
 *   - any element sticking out past the right/left edge
 *   - panel/body heights vs their caps
 *   - the chat scroll position while thinking (answer shoved out of view?)
 *   - overlaps between the panel and the streaming answer
 *   - samples every 250ms through the whole thinking phase
 */
import { chromium } from 'playwright-core';

const UI = 'http://localhost:3000/';
const W = 390, H = 844; // APK-ish viewport

const b = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await b.newPage({ viewport: { width: W, height: H } });

await page.goto(UI, { timeout: 30000, waitUntil: 'domcontentloaded' });
await page.waitForSelector('textarea', { timeout: 15000 });
await page.fill('textarea', 'what is the deepest lake in the world and how deep is it');
await page.press('textarea', 'Enter');

const samples = [];
const t0 = Date.now();
let sawLive = false;
try {
  await page.waitForSelector('[data-testid="agent-thinking-live"]', { timeout: 25000 });
  sawLive = true;
} catch {}

console.log(sawLive ? 'live panel seen — auditing layout…' : 'fast path — auditing completed layout…');

// sample the layout every 250ms for up to 60s (through thinking + answer)
const audit = () => page.evaluate(() => {
  const doc = document.documentElement;
  const vw = window.innerWidth;
  const out = {
    hOverflowPx: Math.max(0, doc.scrollWidth - vw),
    bodyScrollW: document.body.scrollWidth,
    vw,
    offenders: [],
    panelH: null, bodyH: null, headW: null,
    rowClipCount: 0,
    answerVisible: null,
    scrollBottomGap: null,
    container: null,
  };
  const panel = document.querySelector('.jx-agent');
  if (panel) {
    const r = panel.getBoundingClientRect();
    out.panelH = Math.round(r.height);
    if (r.right > vw + 1 || r.left < -1) out.offenders.push(`panel@${Math.round(r.left)},${Math.round(r.right)}`);
    const bodyEl = panel.querySelector('.jx-agent-body');
    if (bodyEl) out.bodyH = Math.round(bodyEl.getBoundingClientRect().height);
    const head = panel.querySelector('.jx-agent-head');
    if (head) out.headW = Math.round(head.getBoundingClientRect().width);
    panel.querySelectorAll('.jx-agent-row-what').forEach((el) => {
      const rr = el.getBoundingClientRect();
      if (rr.right > vw + 1) out.rowClipCount++;
    });
    panel.querySelectorAll('*').forEach((el) => {
      const rr = el.getBoundingClientRect();
      if (rr.width > 0 && (rr.right > vw + 2 || rr.left < -2)) {
        out.offenders.push(`${el.className || el.tagName}@r${Math.round(rr.right)}`);
      }
    });
  }
  // the streaming answer text below the panel
  const stream = document.querySelector('.jx-streaming-text');
  if (stream) {
    const r = stream.getBoundingClientRect();
    out.answerVisible = r.top < window.innerHeight && r.bottom > 0;
    if (r.right > vw + 1) out.offenders.push(`streaming-text@r${Math.round(r.right)}`);
  }
  // chat scroll container: find the scrollable ancestor of the messages
  const cand = [...document.querySelectorAll('div')].filter((el) => el.scrollHeight > el.clientHeight + 4 && el.clientHeight > 200);
  const cont = cand.sort((a, c) => c.scrollHeight - a.scrollHeight)[0];
  if (cont) {
    out.container = cont.className || cont.tagName;
    out.scrollBottomGap = Math.round(cont.scrollHeight - cont.scrollTop - cont.clientHeight);
  }
  out.offenders = [...new Set(out.offenders)].slice(0, 6);
  return out;
});

while (Date.now() - t0 < 60000) {
  const s = await audit().catch(() => null);
  if (s) samples.push({ t: Math.round((Date.now() - t0) / 100) / 10, ...s });
  const done = await page.locator('[data-testid="agent-thinking-done"]').count();
  if (done > 0 && Date.now() - t0 > 8000) break;
  await page.waitForTimeout(250);
}

// ---- report ----
const hMax = Math.max(0, ...samples.map((s) => s.hOverflowPx));
const offTimes = samples.filter((s) => s.offenders.length > 0).length;
const clipMax = Math.max(0, ...samples.map((s) => s.rowClipCount));
const bodyMax = Math.max(0, ...samples.map((s) => s.bodyH || 0));
const panelMax = Math.max(0, ...samples.map((s) => s.panelH || 0));
const headWs = [...new Set(samples.map((s) => s.headW).filter(Boolean))];
const answerEverInvisible = samples.some((s) => s.answerVisible === false);
const gapMax = Math.max(0, ...samples.map((s) => s.scrollBottomGap ?? 0));

console.log(`samples: ${samples.length}`);
console.log(`MAX horizontal overflow: ${hMax}px ${hMax > 1 ? '❌ PAGE BREAKS SIDEWAYS' : '✅'}`);
console.log(`samples with out-of-viewport offenders: ${offTimes}/${samples.length} ${offTimes ? '❌ ' + JSON.stringify(samples.find((s) => s.offenders.length).offenders) : '✅'}`);
console.log(`clipped activity rows (right edge): ${clipMax} ${clipMax ? '❌' : '✅'}`);
console.log(`panel body max height: ${bodyMax}px (cap 210+pad) ${bodyMax > 260 ? '❌' : '✅'}`);
console.log(`panel max height: ${panelMax}px`);
console.log(`head widths seen: ${JSON.stringify(headWs)} (viewport ${W})`);
console.log(`answer ever pushed fully out of view: ${answerEverInvisible ? '⚠️ (check scroll pinning)' : '✅ no'}`);
console.log(`max scroll-bottom gap while live: ${gapMax}px (how far the view lagged the newest content)`);

// final screenshots for the record
await page.screenshot({ path: '/home/user/jexi-audit-final.png' });

// check the deployed-pages build too (what the APK actually ships)
try {
  const p2 = await b.newPage({ viewport: { width: W, height: H } });
  await p2.goto('https://lewiseinstein15-tech.github.io/jexi-os-/', { timeout: 30000, waitUntil: 'domcontentloaded' });
  const over = await p2.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  console.log(`DEPLOYED build horizontal overflow at rest: ${over}px ${over > 1 ? '❌' : '✅'}`);
  await p2.close();
} catch (e) { console.log('deployed check skipped:', String(e.message).slice(0, 80)); }

await b.close();

#!/usr/bin/env node
/**
 * B207 — LAYOUT REGRESSION GUARD: the thinking panel must never break the
 * layout. Found live by the USER on the APK (and confirmed by audit at
 * 390px): the panel blew out to ~1075px wide — 3× the screen — because
 *
 *   ROOT CAUSE (two layers of the same flexbox trap):
 *   1. The AI message wrapper (`div.w-full.group`) is a FLEX ITEM with the
 *      default `min-width: auto`, which refuses to shrink below its
 *      content's min-content width.
 *   2. The panel fed it a huge min-content: activity rows are
 *      `white-space: nowrap`, and `overflow: hidden` on the cell does NOT
 *      remove its contribution to the ANCESTOR's intrinsic width — only an
 *      explicit `min-width: 0` (or `overflow-wrap: anywhere` for wrapped
 *      text) does. Same latent bug in the reasoning block
 *      (`word-break: break-word` does NOT zero min-content).
 *
 *   FIX: `min-w-0` on the wrapper (root) + min-width:0 / max-width:100% on
 *   the panel and its cells + `overflow-wrap: anywhere` on reasoning.
 *
 * Part 1 (always runs): source contracts for every layer of the fix.
 * Part 2 (self-skips without a browser + dev stack): a live Playwright
 * layout audit at 390px — zero horizontal overflow, zero out-of-viewport
 * elements, rows ellipsized not clipped — while she is actually thinking.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf-8');

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};

console.log('B207: layout regression guard\n');

// --- 1. source contracts (the fix itself) ---
console.log('[1] Fix contracts');
{
  const css = read('src/index.css');
  check('panel capped (max-width:100% + min-width:0)', /\.jx-agent \{[^}]*max-width: 100%;[^}]*min-width: 0;/.test(css));
  check('activity cell may shrink (row-what min-width:0)', /\.jx-agent-row-what \{[^}]*min-width: 0;/.test(css));
  check('agent name cell may shrink (row-who min-width:0)', /\.jx-agent-row-who \{[^}]*min-width: 0;/.test(css));
  check('row capped (max-width:100%)', /\.jx-agent-row \{[^}]*max-width: 100%;/.test(css));
  check('reasoning zeroes min-content (overflow-wrap:anywhere)', /\.jx-agent-reason \{[^}]*overflow-wrap: anywhere;/.test(css));
  check('label may shrink', /\.jx-agent-label \{[^}]*min-width: 0;/.test(css));
  check('app shell sized by viewport, not content (jx-workbench min-width:0)', /\.jx-workbench \{[^}]*min-width: 0;/.test(css));
  check('activity rows use zero-minimum grid tracks', /\.jx-agent-row \{[^}]*grid-template-columns: minmax\(0, auto\) minmax\(0, 1fr\)/.test(css));

  const chat = read('src/components/ChatWindow.jsx');
  check('message wrapper is a shrinkable flex item (min-w-0)', /w-full min-w-0 group/.test(chat));
}

// --- 2. live layout audit (self-skip without browser + stack) ---
console.log('\n[2] Live layout audit @390px');
{
  let chromium = null;
  try { chromium = (await import('playwright-core')).chromium; }
  catch { console.log('  ⏭ SKIP — playwright-core not installed'); }
  if (chromium) {
    let browser = null;
    try { browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] }); }
    catch { console.log('  ⏭ SKIP — chromium unavailable'); }
    if (browser) {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      try {
        await page.goto('http://localhost:3000/', { timeout: 8000, waitUntil: 'domcontentloaded' });
      } catch {
        console.log('  ⏭ SKIP — dev stack not running');
        await browser.close();
      }
      if (!page.isClosed?.()) {
        await page.waitForSelector('textarea', { timeout: 15000 });
        // fresh question each run — cached answers can skip the live panel,
        // and this suite is about LAYOUT, not panel existence (b206c covers that)
        const qs = [
          'how deep is Crater Lake in Oregon',
          'what is the tallest mountain in Kenya',
          'compare the Nile and the Congo river lengths',
          'how far is Mars from Earth right now',
          'what year did the Berlin wall fall',
        ];
        await page.fill('textarea', qs[Math.floor(Math.random() * qs.length)]);
        await page.press('textarea', 'Enter');
        try {
          await page.waitForSelector('[data-testid="agent-thinking-live"], [data-testid="agent-thinking-done"]', { timeout: 30000 });
        } catch {
          console.log('  ⏭ SKIP — panel did not render this run (brain wake timing; panel existence is b206c\'s job)');
          await browser.close();
          process.exit(fail ? 1 : 0);
        }

        const worst = { hOverflow: 0, offenders: 0, rowClip: 0, panelW: 0 };
        for (let i = 0; i < 12; i++) {
          const s = await page.evaluate(() => {
            const vw = window.innerWidth;
            const doc = document.documentElement;
            const out = { hOverflow: Math.max(0, doc.scrollWidth - vw), offenders: 0, rowClip: 0, panelW: 0 };
            // an element only breaks the page if NO scrollable/hidden ancestor
            // contains it (content inside overflow-x:auto — e.g. swipeable
            // markdown tables — is clipped by design, not a page break)
            const contained = (el) => {
              let a = el.parentElement;
              while (a) {
                const ox = getComputedStyle(a).overflowX;
                if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') {
                  const ar = a.getBoundingClientRect();
                  if (ar.right <= vw + 2 && ar.left >= -2) return true;
                }
                a = a.parentElement;
              }
              return false;
            };
            const panel = document.querySelector('.jx-agent');
            if (panel) {
              out.panelW = Math.round(panel.getBoundingClientRect().width);
              if (out.panelW > vw) out.offenders++;
              panel.querySelectorAll('*').forEach((el) => {
                const rr = el.getBoundingClientRect();
                if (rr.width > 0 && (rr.right > vw + 2 || rr.left < -2) && !contained(el)) out.offenders++;
              });
              panel.querySelectorAll('.jx-agent-row-what').forEach((el) => {
                if (el.getBoundingClientRect().right > vw + 1) out.rowClip++;
              });
            }
            return out;
          }).catch(() => null);
          if (s) {
            worst.hOverflow = Math.max(worst.hOverflow, s.hOverflow);
            worst.offenders = Math.max(worst.offenders, s.offenders);
            worst.rowClip = Math.max(worst.rowClip, s.rowClip);
            worst.panelW = Math.max(worst.panelW, s.panelW);
          }
          await page.waitForTimeout(400);
        }
        check(`zero horizontal overflow (max seen ${worst.hOverflow}px)`, worst.hOverflow <= 1);
        check(`zero out-of-viewport elements (max ${worst.offenders})`, worst.offenders === 0);
        check(`activity rows ellipsized, not clipped (max ${worst.rowClip})`, worst.rowClip === 0);
        check(`panel never wider than viewport (max ${worst.panelW}px vs 390)`, worst.panelW <= 390);
        await browser.close();
      }
    }
  }
}

console.log(`\nB207: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

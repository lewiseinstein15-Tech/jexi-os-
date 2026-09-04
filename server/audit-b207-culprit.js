#!/usr/bin/env node
/** B207 — find the EXACT element whose width blows out the panel. */
import { chromium } from 'playwright-core';

const b = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await b.newPage({ viewport: { width: 390, height: 844 } });
await page.goto('http://localhost:3000/', { timeout: 30000, waitUntil: 'domcontentloaded' });
await page.waitForSelector('textarea', { timeout: 15000 });
await page.fill('textarea', 'what is the deepest lake in the world and how deep is it');
await page.press('textarea', 'Enter');
await page.waitForSelector('[data-testid="agent-thinking-live"]', { timeout: 25000 }).catch(() => {});

for (let i = 0; i < 6; i++) {
  const r = await page.evaluate(() => {
    const vw = window.innerWidth;
    const panel = document.querySelector('.jx-agent');
    if (!panel) return null;
    const pr = panel.getBoundingClientRect();
    const out = { panelW: Math.round(pr.width), vw, items: [] };
    panel.querySelectorAll('*').forEach((el) => {
      const rr = el.getBoundingClientRect();
      if (rr.width > vw - 20 && rr.width > 0) {
        out.items.push({
          cls: String(el.className).slice(0, 44),
          w: Math.round(rr.width),
          scrollW: el.scrollWidth,
          clientW: el.clientWidth,
          minContentW: (() => { try { return Math.round(el.getBoundingClientRect().width); } catch { return -1; } })(),
          text: (el.textContent || '').slice(0, 70).replace(/\s+/g, ' '),
        });
      }
    });
    // also dump computed styles of the usual suspects
    const suspects = ['.jx-agent-row-what', '.jx-agent-row-who', '.jx-agent-narr span', '.jx-agent-label', '.jx-agent-head'];
    out.styles = suspects.map((sel) => {
      const el = panel.querySelector(sel);
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { sel, whiteSpace: cs.whiteSpace, overflow: cs.overflow, overflowWrap: cs.overflowWrap, wordBreak: cs.wordBreak, minWidth: cs.minWidth, w: Math.round(el.getBoundingClientRect().width), scrollW: el.scrollWidth };
    }).filter(Boolean);
    return out;
  }).catch(() => null);
  if (r) {
    console.log(`--- t+${i * 1.2}s panelW=${r.panelW} (vw ${r.vw})`);
    r.items.slice(0, 5).forEach((it) => console.log(`   WIDE ${it.w}px scrollW=${it.scrollW} cls="${it.cls}" text="${it.text}"`));
    if (i === 0) r.styles.forEach((s) => console.log(`   style ${s.sel}: whiteSpace=${s.whiteSpace} overflow=${s.overflow} wrap=${s.overflowWrap}/${s.wordBreak} minWidth=${s.minWidth} w=${s.w} scrollW=${s.scrollW}`));
  }
  await page.waitForTimeout(1200);
}
await b.close();

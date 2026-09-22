#!/usr/bin/env node
/**
 * Phase 30 Scope H — README captures from the current live console.
 *
 * Pattern: the Phase 24 screenshot harnesses use Playwright against the local
 * Vite console. This script does the same: localhost:3000 for the UI and
 * localhost:3002 for the brain. It never substitutes mocked routes or fixture
 * HTML for product screenshots. Start the live stack first with:
 *
 *   npm run dev:full
 *   node scripts/phase30-readme-shots.mjs
 *
 * Provider-backed generation is not required for the deterministic Phase 16
 * runtime captures: without a configured provider the in-process default agent
 * answers with narration + tool receipts + a turn-end row (not an LLM answer).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'assets', 'screenshots');
const LIVE_ORIGIN = process.env.JEXI_LIVE_ORIGIN || 'http://localhost:3000';
const BRAIN_ORIGIN = process.env.JEXI_BRAIN_ORIGIN || 'http://localhost:3002';
const shot = (name) => path.join(OUT, name);

await fs.mkdir(OUT, { recursive: true });

const healthResponse = await fetch(`${BRAIN_ORIGIN}/api/health`);
const health = await healthResponse.json().catch(() => ({}));
if (!healthResponse.ok || health.ok !== true) {
  throw new Error(`Live brain unavailable at ${BRAIN_ORIGIN}/api/health (HTTP ${healthResponse.status})`);
}
console.log(`LIVE source: ${LIVE_ORIGIN}`);
console.log(`LIVE brain : ${BRAIN_ORIGIN} · HTTP ${healthResponse.status} · v${health.version || 'unknown'}`);

const browser = await chromium.launch({ args: ['--no-sandbox', '--no-proxy-server'] });

async function liveGoto(page, url, selector, timeout = 60_000) {
  await page.goto(url, { waitUntil: 'commit', timeout: 30_000 });
  await page.waitForSelector(selector, { timeout });
}

try {
  /* ------------------------------------------------------------------
   * Phase 30 H-fix: the DEFAULT boot (http://localhost:3000/) now mounts
   * the Phase 24 shell (Chat / Settings / Work Graph). Every product
   * capture below comes from the default origin, not the nested
   * standalone entry. The legacy console is reachable only at #classic.
   * ------------------------------------------------------------------ */
  const p24Context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const p24 = await p24Context.newPage();
  p24.setDefaultTimeout(30_000);
  p24.on('pageerror', (error) => console.log(`PAGEERR default-boot: ${String(error).slice(0, 240)}`));

  // console-hero: empty hash boot -> Phase 24 chat surface.
  await liveGoto(p24, `${LIVE_ORIGIN}/`, '.p24-composer', 180_000);
  await p24.waitForFunction(() => /backend (online|offline)/.test(document.querySelector('.jx-header')?.textContent || ''));
  const navItems = await p24.locator('.jx-nav-item').allTextContents();
  const legacyNav = await p24.evaluate(() => /Executive|Resources|Extensions/.test(document.body.innerText));
  await p24.screenshot({ path: shot('console-hero.png') });
  console.log(`CAPTURE console-hero.png · default boot · hash=${await p24.evaluate(() => location.hash)} · nav=${JSON.stringify(navItems)} · legacy-nav-present=${legacyNav}`);

  // Real Q&A through the live composer: streaming, answer, tool cards.
  await p24.fill('.p24-input', 'What does the scheduler do?');
  // Row-arrival timeline: the deterministic in-process agent finishes a turn in
  // a few milliseconds, so the rows land progressively but faster than any
  // screenshot can be taken. The timeline is logged as the streaming evidence;
  // the capture shows the composer still in its busy state with the rows in.
  await p24.evaluate(() => {
    window.__p30rows = [];
    new MutationObserver(() => {
      window.__p30rows.push({ t: Number(performance.now().toFixed(1)), narration: document.querySelectorAll('.p24-narration').length, toolcards: document.querySelectorAll('.p24-toolcard').length, turnend: document.querySelectorAll('.p24-turnend').length });
    }).observe(document.querySelector('.p24-transcript'), { childList: true, subtree: true });
  });
  await p24.click('.p24-send');
  await p24.waitForSelector('.p24-narration');
  await p24.screenshot({ path: shot('chat-streaming.png') });
  const firstRow = await p24.locator('.p24-narration .p24-row-text').first().textContent();
  const sendLabel = (await p24.locator('.p24-send').textContent())?.trim();
  console.log(`CAPTURE chat-streaming.png · send button=${JSON.stringify(sendLabel)} · first narration row=${JSON.stringify(firstRow)}`);
  console.log(`STREAM timeline (ms since navigation, rows present after each DOM mutation): ${JSON.stringify(await p24.evaluate(() => window.__p30rows))}`);
  await p24.waitForFunction(() => document.body.innerText.includes('turn completed: console-main:turn-1 ok'));
  await p24.screenshot({ path: shot('chat-answer.png') });
  const turnEnd = await p24.locator('.p24-turnend .p24-row-text').first().textContent();
  console.log(`CAPTURE chat-answer.png · ${JSON.stringify(turnEnd)}`);
  await p24.waitForSelector('.p24-toolcard');
  const toolCards = await p24.locator('.p24-toolcard').allInnerTexts();
  await p24.locator('.p24-transcript').screenshot({ path: shot('chat-toolcards.png') });
  console.log(`CAPTURE chat-toolcards.png · ${toolCards.length} live tool cards · ${JSON.stringify(toolCards.map((t) => t.replace(/\s+/g, ' ').trim()))}`);

  // settings-provider: #/settings from the default boot.
  await liveGoto(p24, `${LIVE_ORIGIN}/#/settings`, '.p24-settings');
  const provider = await p24.locator('.p24-select').first().inputValue();
  const keyRefConfigured = (await p24.locator('.p24-keyref-none').count()) === 0;
  await p24.screenshot({ path: shot('settings-provider.png') });
  console.log(`CAPTURE settings-provider.png · provider=${provider} · key-reference-configured=${keyRefConfigured}`);

  // chat-modes: full/act switch + approval-gated write, real receipts.
  await p24.getByRole('button', { name: 'full', exact: true }).click();
  await p24.getByRole('button', { name: 'act', exact: true }).click();
  await liveGoto(p24, `${LIVE_ORIGIN}/#/chat`, '.p24-composer');
  await p24.fill('.p24-input', 'write a scheduler runbook with cron, event, and condition trigger details for the operations team');
  await p24.click('.p24-send');
  await p24.waitForSelector('.p24-approval');
  await p24.getByRole('button', { name: 'approve', exact: true }).click();
  await p24.waitForFunction(() => document.body.innerText.includes('turn completed: console-main:turn-2 ok'));
  await p24.screenshot({ path: shot('chat-modes.png') });
  const modes = await p24.evaluate(async () => (await import('/ui/web/console/chat/runtime.js')).state('console-main').modes);
  console.log(`CAPTURE chat-modes.png · ${modes.displayMode}/${modes.interactionMode} · real approval + tool receipts`);

  // workgraph-nodes: #/graph from the default boot.
  await liveGoto(p24, `${LIVE_ORIGIN}/#/graph`, '.p24-graph-toolbar');
  await p24.waitForFunction(() => {
    const counts = document.querySelector('[data-testid="graph-counts"]');
    return counts && /\d+ nodes? · \d+ edges?/.test(counts.textContent || '');
  });
  const graphCounts = (await p24.locator('[data-testid="graph-counts"]').textContent())?.trim() || 'unknown';
  const graphEmpty = (await p24.locator('[data-testid="graph-empty"]').count()) > 0;
  await p24.screenshot({ path: shot('workgraph-nodes.png') });
  console.log(`CAPTURE workgraph-nodes.png · ${graphCounts}${graphEmpty ? ' · honest live empty state' : ''}`);
  await p24Context.close();

  /* ------------------------------------------------------------------
   * legacy-console.png — record only (NOT linked from README). Proves the
   * legacy console still exists, only behind a deliberate #classic hash.
   * ------------------------------------------------------------------ */
  const legacyContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const legacy = await legacyContext.newPage();
  legacy.setDefaultTimeout(120_000);
  await legacy.addInitScript((brainOrigin) => {
    if (window.top !== window) return;
    localStorage.setItem('jexi_setup_done', '1');
    localStorage.setItem('jexi_backend_url', brainOrigin);
  }, BRAIN_ORIGIN);
  await legacy.goto(`${LIVE_ORIGIN}/#classic`, { waitUntil: 'commit', timeout: 30_000 });
  await legacy.waitForFunction(() => document.querySelector('.jx-app') && !document.querySelector('.jx-shell'), null, { timeout: 120_000 });
  await legacy.waitForTimeout(1500);
  await legacy.screenshot({ path: shot('legacy-console.png') });
  const legacyHasP24 = (await legacy.locator('.jx-shell').count()) > 0;
  console.log(`CAPTURE legacy-console.png · #classic · legacy .jx-app mounted · phase24-shell-present=${legacyHasP24}`);
  await legacyContext.close();

  /* ------------------------------------------------------------------
   * GitHub-style local render of the actual README (P1 evidence).
   * `marked` is already present in the lockfile dependency tree; no package
   * is installed by this script.
   * ------------------------------------------------------------------ */
  const readme = await fs.readFile(path.join(ROOT, 'README.md'), 'utf8');
  const { marked } = await import('marked');
  const rendered = marked.parse(readme, { gfm: true });
  const renderContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const renderPage = await renderContext.newPage();
  // Serve local README assets through the already-running Vite origin. A
  // file:// base on an about:blank setContent document is blocked by Chromium.
  const baseHref = `${LIVE_ORIGIN}/`;
  await renderPage.setContent(`<!doctype html><html><head><meta charset="utf-8"><base href="${baseHref}"><style>
    :root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#f6f8fa;color:#1f2328;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}.frame{width:1120px;margin:34px auto;background:#fff;border:1px solid #d0d7de;border-radius:8px;padding:44px 52px;box-shadow:0 1px 3px rgba(31,35,40,.08)}h1,h2,h3{line-height:1.25}h1{font-size:2em;border-bottom:1px solid #d8dee4;padding-bottom:.3em}h2{font-size:1.5em;border-bottom:1px solid #d8dee4;padding-bottom:.3em;margin-top:28px}a{color:#0969da;text-decoration:none}img{max-width:100%;height:auto}p{margin:0 0 16px}table{border-spacing:0;border-collapse:collapse;display:block;max-width:100%;overflow:auto}th,td{padding:8px 13px;border:1px solid #d0d7de}tr:nth-child(2n){background:#f6f8fa}code{padding:.2em .4em;background:#eff1f3;border-radius:6px;font:85% ui-monospace,SFMono-Regular,Consolas,monospace}pre{padding:16px;overflow:auto;background:#f6f8fa;border-radius:6px}blockquote{margin:0 0 16px;padding:0 1em;color:#59636e;border-left:.25em solid #d0d7de}.markdown-body>p:first-of-type{font-size:18px;color:#59636e}
  </style></head><body><main class="frame markdown-body">${rendered}</main></body></html>`, { waitUntil: 'load' });
  await renderPage.waitForFunction(() => [...document.images].every((img) => img.complete));
  const brokenImages = await renderPage.locator('img').evaluateAll((images) => images
    .filter((image) => image.naturalWidth === 0)
    .map((image) => image.getAttribute('src')));
  if (brokenImages.length) throw new Error(`README render has broken images: ${brokenImages.join(', ')}`);
  await renderPage.screenshot({ path: shot('readme-rendered.png') });
  console.log('CAPTURE readme-rendered.png · actual README rendered with GitHub-style Markdown CSS · 0 broken images');
  await renderContext.close();
} finally {
  await browser.close();
}

console.log('DONE phase30 README captures');

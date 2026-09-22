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
 * runtime captures. The executive-console capture records the provider state
 * exactly as reported by the live brain (including an unconfigured state).
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
const PHASE24 = `${LIVE_ORIGIN}/ui/web/console/shell/index.html`;
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
   * Phase 24 shell + Phase 16 deterministic chat runtime.
   * ------------------------------------------------------------------ */
  const p24Context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const p24 = await p24Context.newPage();
  p24.setDefaultTimeout(30_000);
  p24.on('pageerror', (error) => console.log(`PAGEERR phase24: ${String(error).slice(0, 240)}`));

  await liveGoto(p24, `${PHASE24}#/chat`, '.p24-composer');
  await p24.fill('.p24-input', 'What does the scheduler do?');
  await p24.click('.p24-send');
  await p24.waitForFunction(() => document.body.innerText.includes('turn completed: console-main:turn-1 ok'));
  await p24.waitForSelector('.p24-toolcard');
  await p24.screenshot({ path: shot('chat-toolcards.png') });
  console.log(`CAPTURE chat-toolcards.png · ${await p24.locator('.p24-toolcard').count()} live tool cards`);

  await liveGoto(p24, `${PHASE24}#/settings`, '.p24-settings');
  const provider = await p24.locator('.p24-select').first().inputValue();
  const keyRefConfigured = (await p24.locator('.p24-keyref-none').count()) === 0;
  await p24.screenshot({ path: shot('settings-provider.png') });
  console.log(`CAPTURE settings-provider.png · provider=${provider} · key-reference-configured=${keyRefConfigured}`);

  await p24.getByRole('button', { name: 'full', exact: true }).click();
  await p24.getByRole('button', { name: 'act', exact: true }).click();
  await liveGoto(p24, `${PHASE24}#/chat`, '.p24-composer');
  await p24.fill('.p24-input', 'write a scheduler runbook with cron, event, and condition trigger details for the operations team');
  await p24.click('.p24-send');
  await p24.waitForSelector('.p24-approval');
  await p24.getByRole('button', { name: 'approve', exact: true }).click();
  await p24.waitForFunction(() => document.body.innerText.includes('turn completed: console-main:turn-2 ok'));
  await p24.screenshot({ path: shot('chat-modes.png') });
  const modes = await p24.evaluate(async () => (await import('/ui/web/console/chat/runtime.js')).state('console-main').modes);
  console.log(`CAPTURE chat-modes.png · ${modes.displayMode}/${modes.interactionMode} · real approval + tool receipts`);

  await liveGoto(p24, `${PHASE24}#/graph`, '.p24-graph-toolbar');
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
   * Current React executive console. The boot sequence talks to the live
   * brain, then the automatic replay exposes the real multi-agent plan.
   * No request interception and no seeded response data are used.
   * ------------------------------------------------------------------ */
  const executiveContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const executive = await executiveContext.newPage();
  executive.setDefaultTimeout(180_000);
  executive.on('pageerror', (error) => console.log(`PAGEERR executive: ${String(error).slice(0, 240)}`));
  await executive.addInitScript((brainOrigin) => {
    // Workshop previews use sandboxed child frames; storage setup belongs only
    // to the product's top-level document.
    if (window.top !== window) return;
    localStorage.setItem('jexi_setup_done', '1');
    localStorage.setItem('jexi_backend_url', brainOrigin);
  }, BRAIN_ORIGIN);

  await liveGoto(executive, `${LIVE_ORIGIN}/#chat`, '.vw.active[data-view="chat"]', 180_000);
  let multiAgentStatus = 'verified';
  try {
    await executive.waitForSelector('.plancard', { timeout: 120_000 });
    await executive.waitForFunction(() => document.querySelectorAll('.tcard').length >= 3, { timeout: 30_000 });
  } catch (error) {
    multiAgentStatus = `NOT VERIFIED - ${String(error).split('\n')[0]}`;
  }
  await executive.screenshot({ path: shot('console-hero.png') });
  console.log(`CAPTURE console-hero.png · live executive console · multi-agent=${multiAgentStatus}`);

  const summaries = executive.locator('.tcard summary');
  const summaryCount = await summaries.count();
  for (let i = 0; i < Math.min(2, summaryCount); i += 1) {
    await summaries.nth(i).click().catch(() => {});
  }
  await executive.screenshot({ path: shot('chat-multiagent.png') });
  const rosterText = await executive.locator('.plancard').first().innerText().catch(() => 'plan unavailable');
  console.log(`CAPTURE chat-multiagent.png · ${rosterText.replace(/\s+/g, ' ').slice(0, 180)}`);

  await executive.evaluate(() => { window.location.hash = '#agents'; });
  await executive.waitForSelector('.vw.active[data-view="agents"]');
  await executive.waitForFunction(() => document.querySelectorAll('.vw.active[data-view="agents"] .rowline').length > 0);
  await executive.screenshot({ path: shot('agents-view.png') });
  const agentRows = await executive.locator('.vw.active[data-view="agents"] .rowline').count();
  console.log(`CAPTURE agents-view.png · ${agentRows} live contract rows`);

  // The classic Files surface has a real workspace checkpoint control. It is
  // separate from Phase 16's runtime-only chat checkpoint module; the README
  // labels that distinction and does not invent a chat checkpoint panel.
  await executive.evaluate(() => { window.location.hash = '#classic'; });
  await executive.waitForSelector('.jx-app');
  await executive.getByRole('button', { name: 'Files', exact: true }).click();
  await executive.getByText('WORKSPACE RUNTIME', { exact: true }).waitFor();
  // Keep the surface at its real top position: the CHECKPOINT action and the
  // live checkpoint count are both visible without rearranging product UI.
  await executive.waitForTimeout(350);
  await executive.screenshot({ path: shot('checkpoint.png') });
  const workspaceText = await executive.locator('.jx-view.show').innerText();
  const checkpointMatch = workspaceText.match(/(\d+)\s+CHECKPOINTS/);
  console.log(`CAPTURE checkpoint.png · live workspace checkpoint surface · count=${checkpointMatch?.[1] || 'unknown'}`);
  await executiveContext.close();

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

/**
 * Phase 24 Scope D evidence — Work Graph surface.
 * Shots: graph-overview, graph-zoomed, graph-node-detail, graph-empty.
 * Run against vite :3000 (proxies /api -> brain :3002).
 */
import { chromium } from 'playwright';
import path from 'path';

const OUT = (f) => path.join(process.cwd(), 'docs', f);
const URL_BASE = 'http://localhost:3000/ui/web/console/shell/index.html';

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
page.on('pageerror', (e) => console.log('PAGEERR:', String(e).slice(0, 200)));

async function gotoGraph() {
  await page.goto(URL_BASE + '#/graph', { waitUntil: 'load' });
  await page.waitForSelector('.p24-graph-toolbar', { timeout: 20000 });
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="layout-hash"]');
    return el && el.textContent.includes('layout hash:');
  }, { timeout: 20000 });
}

// P1 — route renders, sidebar exactly 3, Work Graph active
await gotoGraph();
const nav = await page.$$eval('.jx-nav-item', (els) => els.map((e) => e.textContent.trim()));
const active = await page.$eval('.jx-nav-item.is-active', (e) => e.textContent.trim());
console.log('P1 sidebar:', JSON.stringify(nav), 'active:', active);
await page.screenshot({ path: OUT('phase24-scopeD-graph-overview.png') });
console.log('P1 shot: graph-overview');

// P2 — rendered node/edge count vs API-reported count
const selected = await page.$eval('.p24-graph-select', (e) => e.value);
const apiCounts = await page.evaluate(async (id) => {
  const res = await fetch('/api/missions/' + encodeURIComponent(id));
  const d = await res.json();
  return { items: (d.graph && d.graph.items || []).length, relations: (d.graph && d.graph.relations || []).length };
}, selected);
const renderedNodes = await page.$$eval('.p24-gnode-card', (els) => els.length);
const renderedEdges = await page.$$eval('svg .p24-graph-canvas-el path, .p24-graph-canvas-el svg path', (els) => els.length).catch(() => 'n/a');
const toolbar = await page.$eval('[data-testid="graph-counts"]', (e) => e.textContent);
console.log('P2 mission:', selected, '| API items:', apiCounts.items, 'relations:', apiCounts.relations);
console.log('P2 rendered node cards:', renderedNodes, '| toolbar:', toolbar, '| svg paths:', renderedEdges);
console.log('P2 shot: graph-overview (same surface)');

// P3 — zoom + pan
const svgBefore = await page.evaluate(() => { const g = document.querySelector('.p24-graph-canvas svg > g'); return g ? (g.getAttribute('style') || g.getAttribute('transform')) : null; });
await page.mouse.move(720, 500);
await page.mouse.wheel(0, -240);
await page.waitForTimeout(400);
await page.mouse.wheel(0, -240);
await page.waitForTimeout(400);
await page.mouse.move(720, 500);
await page.mouse.down();
await page.mouse.move(620, 460, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(400);
const svgAfter = await page.evaluate(() => { const g = document.querySelector('.p24-graph-canvas svg > g'); return g ? (g.getAttribute('style') || g.getAttribute('transform')) : null; });
console.log('P3 transform before:', svgBefore);
console.log('P3 transform after :', svgAfter);
await page.screenshot({ path: OUT('phase24-scopeD-graph-zoomed.png') });
console.log('P3 shot: graph-zoomed');

// P4 — click node -> detail panel; Esc dismisses
await page.click('.p24-graph-canvas svg g[id*="-node-"] > rect');
await page.waitForSelector('[data-testid="node-detail"]', { timeout: 5000 });
const detail = await page.evaluate(() => ({
  id: document.querySelector('[data-testid="detail-id"]').textContent,
  kind: document.querySelector('[data-testid="detail-kind"]').textContent,
  label: document.querySelector('[data-testid="detail-label"]').textContent,
  edges: document.querySelectorAll('.p24-gdetail-edge').length,
}));
console.log('P4 detail:', JSON.stringify(detail));
await page.screenshot({ path: OUT('phase24-scopeD-graph-node-detail.png') });
console.log('P4 shot: graph-node-detail');
await page.keyboard.press('Escape');
await page.waitForSelector('[data-testid="node-detail"]', { state: 'detached', timeout: 5000 });
console.log('P4 Esc dismissed: panel gone');

// P5 — empty state from a real mission with 0 items
const emptyId = await page.evaluate(async () => {
  const list = await (await fetch('/api/missions')).json();
  for (const m of list.missions) {
    const s = await (await fetch('/api/missions/' + encodeURIComponent(m.id))).json();
    if (!s.graph || (s.graph.items || []).length === 0) return m.id;
  }
  return null;
});
if (emptyId) {
  await page.selectOption('.p24-graph-select', emptyId);
  await page.waitForSelector('[data-testid="graph-empty"]', { timeout: 5000 });
  const emptyText = await page.$eval('.p24-graph-empty-title', (e) => e.textContent);
  console.log('P5 empty state for real mission', emptyId, ':', emptyText);
} else {
  console.log('P5 no zero-item mission on this API — empty state NOT VERIFIED');
}
await page.screenshot({ path: OUT('phase24-scopeD-graph-empty.png') });
console.log('P5 shot: graph-empty');

// P6 — determinism: two fresh loads -> identical layout hash
await gotoGraph();
const hash1 = await page.$eval('[data-testid="layout-hash"]', (e) => e.textContent);
await gotoGraph();
const hash2 = await page.$eval('[data-testid="layout-hash"]', (e) => e.textContent);
console.log('P6 load1:', hash1);
console.log('P6 load2:', hash2);
console.log('P6 identical:', hash1 === hash2 && hash1.includes('layout hash:'));

await browser.close();
console.log('DONE');

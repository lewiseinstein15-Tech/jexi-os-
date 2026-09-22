/**
 * Phase 24 Scope E evidence — polish pass (AFTER state + probes).
 * Assumes brain :3002 is UP. The brain-off error shots are a separate script.
 */
import { chromium } from 'playwright';
import path from 'path';

const OUT = (f) => path.join(process.cwd(), 'docs', f);
const URL_BASE = 'http://localhost:3000/ui/web/console/shell/index.html';
const browser = await chromium.launch();

async function newPage(opts) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...opts });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERR:', String(e).slice(0, 200)));
  return page;
}

/* ---------- P2: Scope B Q&A still works (fresh session, default modes) ---------- */
let page = await newPage();
await page.goto(URL_BASE + '#/chat', { waitUntil: 'load' });
await page.waitForSelector('.p24-composer', { timeout: 15000 });
await page.fill('.p24-input', 'what does the scheduler do?');
await page.click('.p24-send');
await page.waitForSelector('.p24-turnend', { timeout: 15000 });
const narr = await page.$eval('.p24-narration', (e) => e.textContent.trim());
const turnend = await page.$eval('.p24-turnend', (e) => e.textContent.trim());
console.log('P2 narration row:', JSON.stringify(narr));
console.log('P2 turn-end row :', JSON.stringify(turnend));
await page.screenshot({ path: OUT('phase24-scopeE-chat-after.png') });
console.log('P2 shot: chat-after (transcript visible)');

/* ---------- P3: mode switch in settings -> chat renders at new verbosity ---------- */
await page.goto(URL_BASE + '#/settings', { waitUntil: 'load' });
await page.waitForSelector('.p24-section', { timeout: 15000 });
await page.click('.p24-btn-group[aria-label="Display mode"] >> text=full');
await page.click('.p24-btn-group[aria-label="Interaction mode"] >> text=act');
const modes = await page.evaluate(async () => (await import('/ui/web/console/chat/runtime.js')).state('console-main').modes);
console.log('P3 modes after switch:', JSON.stringify(modes));
await page.screenshot({ path: OUT('phase24-scopeE-settings-after.png') });
await page.click('.jx-nav-item >> text=Chat');
await page.waitForSelector('.p24-composer');
const longQ = 'write a detailed scheduler note: '.repeat(4) + 'Please explain the scheduler in detail. '.repeat(10) + 'Cover the cron event and condition triggers thoroughly so the tool arguments exceed six hundred characters for the verbosity check.';
await page.fill('.p24-input', longQ);
await page.click('.p24-send');
await page.waitForSelector('.p24-approval', { timeout: 10000 });
await page.click('.p24-approval >> text=approve');
await page.waitForSelector('.p24-toolcard.tool-use .p24-tool-body', { timeout: 15000 });
const body = await page.$eval('.p24-toolcard.tool-use .p24-tool-body', (e) => e.textContent);
console.log('P3 tool body length at display=full:', body.length, '| truncated?', body.includes('…'));
await page.screenshot({ path: OUT('phase24-scopeE-chat-mode-full.png') });
console.log('P3 shot: chat-mode-full');
await page.context().close();

/* ---------- P4: keyboard navigation ---------- */
page = await newPage();
await page.goto(URL_BASE + '#/chat', { waitUntil: 'load' });
await page.waitForSelector('.p24-composer', { timeout: 15000 });
await page.evaluate(() => document.body.focus());
const seq = [];
for (let i = 0; i < 6; i++) {
  await page.keyboard.press('Tab');
  seq.push(await page.evaluate(() => {
    const a = document.activeElement;
    return (a.tagName + (a.className && typeof a.className === 'string' ? '.' + a.className.split(' ')[0] : '')) + ' "' + (a.textContent || a.getAttribute('aria-label') || '').trim().slice(0, 20) + '"';
  }));
}
console.log('P4 tab order:', JSON.stringify(seq, null, 1));
// focus Work Graph (3rd sidebar item) and press Enter
await page.evaluate(() => document.querySelectorAll('.jx-nav-item')[2].focus());
await page.keyboard.press('Enter');
await page.waitForTimeout(400);
console.log('P4 Enter on focused "Work Graph" -> hash:', await page.evaluate(() => window.location.hash));
// node detail + Esc
await page.waitForSelector('.p24-gnode-card', { timeout: 20000 });
await page.click('.p24-graph-canvas svg g[id*="-node-"] > rect');
await page.waitForSelector('[data-testid="node-detail"]');
await page.keyboard.press('Escape');
await page.waitForSelector('[data-testid="node-detail"]', { state: 'detached' });
console.log('P4 Esc dismissed node detail: true');
// composer: Shift+Enter newline, Enter sends
await page.click('.jx-nav-item >> text=Chat');
await page.waitForSelector('.p24-composer');
await page.click('.p24-input');
await page.keyboard.type('line one');
await page.keyboard.press('Shift+Enter');
await page.keyboard.type('line two');
const val = await page.$eval('.p24-input', (e) => e.value);
console.log('P4 Shift+Enter newline ->', JSON.stringify(val));
await page.keyboard.press('Enter');
await page.waitForSelector('.p24-row.p24-text', { timeout: 10000 });
const sent = await page.$eval('.p24-row.p24-text', (e) => e.textContent);
console.log('P4 Enter sent ->', JSON.stringify(sent));
await page.context().close();

/* ---------- P1 after shots: shell + graph (+ settings/chat already captured) ---------- */
page = await newPage();
await page.goto(URL_BASE + '#/chat', { waitUntil: 'load' });
await page.waitForSelector('.jx-shell');
await page.waitForTimeout(500);
await page.screenshot({ path: OUT('phase24-scopeE-shell-after.png') });
await page.goto(URL_BASE + '#/graph', { waitUntil: 'load' });
await page.waitForSelector('.p24-gnode-card', { timeout: 20000 });
await page.waitForTimeout(500);
await page.screenshot({ path: OUT('phase24-scopeE-graph-after.png') });
// focus ring shot: Tab onto a sidebar item
await page.goto(URL_BASE + '#/chat', { waitUntil: 'load' });
await page.waitForSelector('.jx-shell');
await page.keyboard.press('Tab');
await page.waitForTimeout(200);
const focused = await page.evaluate(() => {
  const a = document.activeElement;
  const cs = getComputedStyle(a);
  return { el: a.textContent.trim(), outline: cs.outlineColor + ' ' + cs.outlineWidth + ' ' + cs.outlineStyle };
});
console.log('P4/P3b focus ring on:', JSON.stringify(focused));
await page.screenshot({ path: OUT('phase24-scopeE-focus-ring.png') });
console.log('shot: focus-ring');
await page.context().close();

/* ---------- empty states (fresh context = no messages, no keyRef) + keyRef refused ---------- */
page = await newPage();
await page.goto(URL_BASE + '#/chat', { waitUntil: 'load' });
await page.waitForSelector('.p24-empty', { timeout: 15000 });
await page.screenshot({ path: OUT('phase24-scopeE-empty-chat.png') });
await page.goto(URL_BASE + '#/settings', { waitUntil: 'load' });
await page.waitForSelector('.p24-keyref-none', { timeout: 15000 });
await page.screenshot({ path: OUT('phase24-scopeE-empty-settings.png') });
await page.goto(URL_BASE + '#/graph', { waitUntil: 'load' });
await page.waitForSelector('.p24-graph-toolbar', { timeout: 20000 });
const emptyId = await page.evaluate(async () => {
  const list = await (await fetch('/api/missions')).json();
  for (const m of list.missions) {
    const s = await (await fetch('/api/missions/' + encodeURIComponent(m.id))).json();
    if (!s.graph || (s.graph.items || []).length === 0) return m.id;
  }
  return null;
});
await page.selectOption('.p24-graph-select', emptyId);
await page.waitForSelector('[data-testid="graph-empty"]');
await page.screenshot({ path: OUT('phase24-scopeE-empty-graph.png') });
console.log('P7 empty graph mission:', emptyId);
// keyRef refused (error state, brain on)
await page.goto(URL_BASE + '#/settings', { waitUntil: 'load' });
await page.waitForSelector('.p24-keyref input');
await page.fill('.p24-keyref input', 'sk-inline-abc123');
await page.click('.p24-keyref .p24-send');
await page.waitForSelector('.p24-keyref-refused');
console.log('P7 keyRef refused:', await page.$eval('.p24-keyref-refused', (e) => e.textContent.trim()));
await page.screenshot({ path: OUT('phase24-scopeE-error-keyref.png') });
await page.context().close();

/* ---------- P6: reduced-motion respected (emulated) ---------- */
const normal = await newPage();
await normal.goto(URL_BASE + '#/chat', { waitUntil: 'load' });
await normal.waitForSelector('.jx-shell');
const tdNormal = await normal.$eval('.jx-nav-item', (e) => getComputedStyle(e).transitionDuration);
await normal.context().close();
const reduced = await newPage({ reducedMotion: 'reduce' });
await reduced.goto(URL_BASE + '#/chat', { waitUntil: 'load' });
await reduced.waitForSelector('.jx-shell');
const tdReduced = await reduced.$eval('.jx-nav-item', (e) => getComputedStyle(e).transitionDuration);
console.log('P6 nav transition-duration normal:', tdNormal, '| prefers-reduced-motion:', tdReduced);
await reduced.context().close();

await browser.close();
console.log('DONE (brain-on section)');

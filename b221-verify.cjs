/** B207/B221 — programmatic layout verification at 390×844 against the REAL brain. */
const { chromium } = require('playwright');

const BASE = 'http://localhost:4173';
const BACKEND = 'https://jexi-brain-image.onrender.com';
const SHOT_DIR = '/home/user/jexi-os/b221-shots';
const VIEWS = [
  ['chat', 'Chat', 'JEXI'], ['history', 'Chat history', 'Chat history'], ['agents', 'Team', 'AGENT TIMELINE'],
  ['missions', 'Missions', 'Missions'], ['workshop', 'Workshop', 'Workshop'],
  ['tasks', 'Tasks', 'Background Missions'], ['goals', 'Goals', 'Goals'],
  ['projects', 'Projects', 'Projects'], ['files', 'Files', 'WORKSPACE'], ['terminal', 'Terminal', 'TERMINAL'],
  ['skills', 'Skills', 'Skills'], ['research', 'Research', 'Research console'],
  ['models', 'Models', 'ORCHESTRATOR'], ['mcp', 'MCP', 'MCP SERVER'],
  ['notifications', 'Notifications', 'Notifications'], ['connectors', 'Connectors', 'CONNECTORS'],
  ['plugins', 'Plugins', 'PLUGINS'],
  ['memory', 'Memory', 'Memory'], ['books', 'Books', 'Books'],
  ['app', 'Get the app', 'Real App'], ['settings', 'Settings', 'Settings'],
];

(async () => {
  const fs = require('fs');
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(([b, k]) => {
      try { localStorage.setItem('jexi_backend_url', b); localStorage.setItem('jexi_access_key', k); } catch (e) {}
    }, [BACKEND, 'com/0006/25']);
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + String(e).slice(0, 160)));

  const check = async (name) => {
    await page.waitForTimeout(1100); // let data/poll settle (B207: no networkidle)
    const r = await page.evaluate(() => {
      const doc = document.documentElement;
      const offenders = [];
      const clipped = (el) => { // true if an ancestor with overflow hidden fully clips the overflow
        let p = el.parentElement;
        while (p && p !== document.body) {
          const pcs = getComputedStyle(p);
          if (/(hidden|clip)/.test(pcs.overflow + pcs.overflowX + pcs.overflowY)) {
            const pr = p.getBoundingClientRect();
            if (pr.right < 392.5) return true;
          }
          if (/(auto|scroll)/.test(pcs.overflowX)) return true; // horizontally scrollable container
          p = p.parentElement;
        }
        return false;
      };
      for (const el of document.querySelectorAll('body *')) {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || cs.position === 'fixed') continue;
        const rect = el.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) continue;
        if ((rect.right > 392.5 || rect.left < -2.5) && !clipped(el)) {
          offenders.push(`${el.tagName}.${String(el.className).split(' ')[0]} r=${Math.round(rect.right)} l=${Math.round(rect.left)}`);
        }
      }
      return { sw: doc.scrollWidth, offenders: offenders.slice(0, 5) };
    });
    const ok = r.sw <= 391 && r.offenders.length === 0;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name} — scrollW=${r.sw}${r.offenders.length ? ' offenders: ' + r.offenders.join(' | ') : ''}`);
    await page.screenshot({ path: `${SHOT_DIR}/${name.replace(/[^a-z0-9]+/gi, '-')}.png` });
    return ok;
  };

  let fails = 0;
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.jx-burger', { timeout: 60000 });
  await page.waitForTimeout(1500);

  // all views via the burger menu — click label, then PROVE the view rendered
  for (const [v, label, proof] of VIEWS) {
    let navOK = true;
    try {
      await page.click('.jx-burger');
      await page.waitForSelector('.jx-menu.open', { timeout: 4000 });
      await page.click(`.jx-mi:has-text("${label}")`, { timeout: 4000 });
      await page.waitForSelector('.jx-menu:not(.open)', { timeout: 4000 });
      await page.waitForSelector(`.jx-view.show >> text=${proof}`, { timeout: 15000 });
    } catch (e) { navOK = false; console.log(`NAV-FAIL ${v}: ${String(e).slice(0, 110)}`); }
    const layoutOK = await check(`view-${v}`);
    if (!navOK || !layoutOK) fails++;
  }

  console.log(`console-errors: ${errors.length}`);
  errors.slice(0, 10).forEach((e) => console.log('  ERR:', e));
  console.log(fails === 0 && errors.length === 0 ? 'ALL CLEAN' : `DONE — ${fails} layout fails, ${errors.length} console errors`);
  await browser.close();
  process.exit(fails === 0 ? 0 : 1);
})();

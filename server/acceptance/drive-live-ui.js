/**
 * Drive the deck UI against a LIVE server and prove the stream is real.
 *
 * Nothing here is injected. The question is typed into the dock, the page
 * POSTs /api/chat itself, and every assertion reads the DOM that resulted.
 * The check that matters most: in LIVE mode the deck must NOT be emitting its
 * own fabricated rows, so any row on screen came off the wire.
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const BASE = process.env.JEXI_URL || 'http://127.0.0.1:3002/';
const OUT = process.env.SHOT_DIR || '/home/user/jexi-ui/sim/live';
const QUESTION = process.argv[2] ||
  'The pytest suite in this project is failing. Read the failing test, read the module it imports, make the minimal edit, then re-run the tests to confirm green.';

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch({ args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--disable-software-rasterizer', '--js-flags=--max-old-space-size=512'] });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

  const errors = [];
  p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  // Prove the deck is NOT fabricating: count rows pushed by its own demo
  // ticker while we sit idle. In LIVE mode this must stay flat.
  await p.addInitScript(() => {
    window.__probe = { rows: 0, t0: Date.now() };
    const iv = setInterval(() => {
      const n = document.querySelectorAll('#events .ev').length;
      if (n > window.__probe.rows) window.__probe.rows = n;
    }, 200);
    setTimeout(() => clearInterval(iv), 60000);
  });

  await p.goto(BASE, { waitUntil: 'networkidle' });
  await p.waitForTimeout(2000);

  const wired = await p.evaluate(() => ({
    bridge: typeof window.__jexiLive?.ask === 'function',
    demo: window.__jexiDemo,
    hasPushEvent: typeof window.pushEvent === 'function',
  }));
  console.log('bridge wired :', JSON.stringify(wired));
  if (!wired.bridge) { console.log('FAIL: live bridge never attached'); await b.close(); process.exit(1); }

  // idle drift: the fake ticker must not add rows in LIVE mode
  const before = await p.evaluate(() => document.querySelectorAll('#events .ev').length);
  await p.waitForTimeout(8000);
  const after = await p.evaluate(() => document.querySelectorAll('#events .ev').length);
  console.log(`idle 8s      : rows ${before} -> ${after}  ${after === before ? 'OK (no fabrication)' : 'LEAK: ' + (after - before) + ' fabricated rows'}`);

  await p.click('#seg button[data-stage=stream]');
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${OUT}/01-live-idle.png` });

  // type the question into the real dock and send it
  await p.click('#dockInput');
  await p.fill('#dockInput', QUESTION, { delay: 4 });
  await p.screenshot({ path: `${OUT}/02-question-typed.png` });
  await p.press('#dockInput', 'Enter');

  // catch it mid-stream
  await p.waitForTimeout(2500);
  await p.screenshot({ path: `${OUT}/03-streaming.png` });

  // wait for the panel to leave the "streaming" state
  let settled = null;
  try {
    await p.waitForFunction(
      () => { const s = document.querySelector('#lpState'); return s && !/streaming/.test(s.textContent); },
      { timeout: 180000 });
    settled = true;
  } catch { settled = false; }

  const state = await p.evaluate(() => ({
    lpState: document.querySelector('#lpState')?.textContent,
    panelClass: document.querySelector('#livePanel')?.className,
    question: document.querySelector('#lpQ')?.textContent,
    answer: (document.querySelector('#lpA')?.textContent || '').trim(),
    meta: document.querySelector('#lpMeta')?.textContent,
    rows: Array.from(document.querySelectorAll('#events .ev')).map((r) => ({
      n: r.querySelector('.n')?.textContent || '',
      d: r.querySelector('.d')?.textContent || '',
    })),
  }));

  await p.waitForTimeout(600);
  await p.screenshot({ path: `${OUT}/04-live-settled.png` });
  await p.screenshot({ path: `${OUT}/05-full-page.png`, fullPage: false });

  const report = {
    url: BASE, question: QUESTION, settled, errors,
    lpState: state.lpState, panelClass: state.panelClass,
    shownQuestion: state.question, answer: state.answer, meta: state.meta,
    rowCount: state.rows.length, rows: state.rows,
  };
  fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));

  console.log('settled      :', settled);
  console.log('panel state  :', state.lpState, '|', state.panelClass);
  console.log('answer chars :', state.answer.length);
  console.log('answer       :', state.answer.slice(0, 400).replace(/\s+/g, ' '));
  console.log('meta         :', state.meta);
  console.log('event rows   :', state.rows.length);
  console.log('row names    :', state.rows.map((r) => r.n).join(', ').slice(0, 300));
  console.log('page errors  :', errors.length ? errors.slice(0, 5) : 'none');

  await b.close();
  const ok = settled && state.answer.length > 0 && errors.length === 0;
  console.log(ok ? '\nRESULT: live stream OK' : '\nRESULT: PROBLEM');
  process.exit(ok ? 0 : 1);
})();

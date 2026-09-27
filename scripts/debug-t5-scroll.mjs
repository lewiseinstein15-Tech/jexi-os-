#!/usr/bin/env node
// DEBUG 4: T5 auto-scroll pill behavior.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3084;
const BASE = `http://127.0.0.1:${PORT}`;
const { chromium } = require('playwright');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), `b8dbg4-`));
const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: dataDir, JEXI_MCP_MINIMAL: '1', NODE_ENV: 'production' };
const child = spawn(process.execPath, ['index.js'], { cwd: path.join(ROOT, 'server'), env, stdio: ['ignore', 'pipe', 'pipe'] });
for (let i = 0; i < 60; i++) { try { const r = await fetch(`${BASE}/api/health`); if (r.ok) break; } catch {} await wait(1000); }

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
await page.goto(`${BASE}/#/chat`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('textarea', { timeout: 30000 });

// fill the transcript first so there is scroll overflow: a couple of turns
for (const q of ['what is 2+2?', 'run pwd']) {
  await page.fill('textarea', q);
  await page.press('textarea', 'Enter');
  await page.waitForFunction(() => document.querySelectorAll('.jx-footer').length >= 1, undefined, { timeout: 120000 });
  await wait(300);
}
const footersBefore = await page.$$eval('.jx-footer', (els) => els.length);
// a long-answer turn
await page.fill('textarea', 'explain Bayes theorem in detail');
await page.press('textarea', 'Enter');
await page.waitForFunction(() => Boolean(document.querySelector('.jx-answer')), undefined, { timeout: 120000 });
console.log('answer row present');
await page.evaluate(() => { const el = document.querySelector('.jx-transcript'); el.scrollTop = 0; });
for (let i = 0; i < 8; i++) {
  await wait(400);
  const st = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('.jx-transcript'));
    const el = all[0];
    const pill = document.querySelector('.jx-jump-latest');
    return {
      count: all.length,
      info: all.map((e) => ({ cls: e.className, h: e.clientHeight, sh: e.scrollHeight, visible: !!(e.offsetWidth || e.offsetHeight) })),
      scrollTop: el ? Math.round(el.scrollTop) : null,
      scrollHeight: el ? el.scrollHeight : null,
      clientHeight: el ? el.clientHeight : null,
      pill: Boolean(pill),
      pinned: el ? el.getAttribute('data-pinned') : 'attr-missing',
    };
  });
  console.log(`pre-click t=${(i + 1) * 0.4}s`, JSON.stringify(st));
  if (st.pill) break;
}
// click the pill and watch the state for 6s
const pill = await page.$('.jx-jump-latest');
if (pill) {
  await pill.click();
  for (let i = 0; i < 12; i++) {
    await wait(500);
    const st2 = await page.evaluate(() => {
      const el = document.querySelector('.jx-transcript');
      const pill2 = document.querySelector('.jx-jump-latest');
      return {
        scrollTop: Math.round(el.scrollTop),
        scrollHeight: el.scrollHeight,
        dist: el.scrollHeight - el.scrollTop - el.clientHeight,
        pill: Boolean(pill2),
        pinned: el.getAttribute('data-pinned'),
      };
    });
    console.log(`post-click t=${(i + 1) * 0.5}s`, JSON.stringify(st2));
    if (st2.dist <= 120 && !st2.pill) break;
  }
} else {
  console.log('NO PILL TO CLICK');
}
await browser.close();
try { child.kill('SIGKILL'); } catch {}
fs.rmSync(dataDir, { recursive: true, force: true });
process.exit(0);

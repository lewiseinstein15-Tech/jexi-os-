#!/usr/bin/env node
// DEBUG 2: drive the real turn, then dump the full transcript DOM.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3081;
const BASE = `http://127.0.0.1:${PORT}`;
const { chromium } = require('playwright');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), `b8dbg2-`));
const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: dataDir, JEXI_MCP_MINIMAL: '1', NODE_ENV: 'production' };
const child = spawn(process.execPath, ['index.js'], { cwd: path.join(ROOT, 'server'), env, stdio: ['ignore', 'pipe', 'pipe'] });
for (let i = 0; i < 60; i++) { try { const r = await fetch(`${BASE}/api/health`); if (r.ok) break; } catch {} await wait(1000); }

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 300)));
await page.goto(`${BASE}/#/chat`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('textarea', { timeout: 30000 });
await page.fill('textarea', 'run ls -la');
await page.press('textarea', 'Enter');
// wait until the footer shows the turn ended
await page.waitForFunction(() => document.querySelectorAll('.jx-footer').length > 0, undefined, { timeout: 240000 });
await wait(800);
const dump = await page.evaluate(() => {
  const t = document.querySelector('.jx-transcript');
  if (!t) return 'NO TRANSCRIPT';
  const rows = t.querySelectorAll('[data-rowtype], .jx-term, .jx-tool, .jx-think, .jx-steps, .jx-answer, .jx-footer');
  return Array.from(rows).map((el) => `${el.className.toString().slice(0, 60)} :: ${el.textContent.slice(0, 140)}`).join('\n---\n');
});
console.log(dump);
await browser.close();
try { child.kill('SIGKILL'); } catch {}
fs.rmSync(dataDir, { recursive: true, force: true });
process.exit(0);

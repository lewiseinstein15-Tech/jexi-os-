#!/usr/bin/env node
// DEBUG: intercept NDJSON in the live browser + dump mounted rows state.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3079;
const BASE = `http://127.0.0.1:${PORT}`;
const { chromium } = require('playwright');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), `b8dbg-`));
const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: dataDir, JEXI_MCP_MINIMAL: '1', NODE_ENV: 'production' };
const child = spawn(process.execPath, ['index.js'], { cwd: path.join(ROOT, 'server'), env, stdio: ['ignore', 'pipe', 'pipe'] });
let boot = '';
child.stdout.on('data', (d) => { boot += d; });
child.stderr.on('data', (d) => { boot += d; });
for (let i = 0; i < 60; i++) { try { const r = await fetch(`${BASE}/api/health`); if (r.ok) break; } catch {} await wait(1000); }

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
page.on('console', (m) => { const t = m.text(); if (t.includes('[NDJSON]')) console.log('BROWSER:', t.slice(0, 300)); });
page.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 200)));
await page.route('**/api/chat', async (route) => {
  const resp = await route.fetch();
  const body = await resp.text();
  for (const line of body.split('\n')) {
    if (!line.trim()) continue;
    try { const ev = JSON.parse(line); console.log('BROWSER: [NDJSON]', JSON.stringify(ev).slice(0, 220)); } catch {}
  }
  await route.fulfill({ response: resp, body });
});
await page.goto(`${BASE}/#/chat`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('textarea', { timeout: 30000 });
await page.fill('textarea', 'run ls -la');
await page.press('textarea', 'Enter');
await wait(90000);
const termHtml = await page.evaluate(() => {
  const el = document.querySelector('.jx-term');
  return el ? el.outerHTML.slice(0, 500) : 'NO .jx-term IN DOM';
});
console.log('DOM:', termHtml);
await browser.close();
try { child.kill('SIGKILL'); } catch {}
fs.rmSync(dataDir, { recursive: true, force: true });
process.exit(0);

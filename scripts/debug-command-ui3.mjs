#!/usr/bin/env node
// DEBUG 3: capture server stderr/stdout during a browser turn.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3082;
const BASE = `http://127.0.0.1:${PORT}`;
const { chromium } = require('playwright');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), `b8dbg3-`));
const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: dataDir, JEXI_MCP_MINIMAL: '1', NODE_ENV: 'production' };
const child = spawn(process.execPath, ['index.js'], { cwd: path.join(ROOT, 'server'), env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
child.stdout.on('data', (d) => { log += d; });
child.stderr.on('data', (d) => { log += d; });
for (let i = 0; i < 60; i++) { try { const r = await fetch(`${BASE}/api/health`); if (r.ok) break; } catch {} await wait(1000); }

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 200)));
await page.goto(`${BASE}/#/chat`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('textarea', { timeout: 30000 });
await page.fill('textarea', 'run ls -la');
await page.press('textarea', 'Enter');
await page.waitForFunction(() => document.querySelectorAll('.jx-footer').length > 0, undefined, { timeout: 240000 });
await wait(800);
const dump = await page.evaluate(() => {
  const t = document.querySelector('.jx-transcript');
  if (!t) return 'NO TRANSCRIPT';
  return Array.from(t.querySelectorAll('[data-rowtype], .jx-term, .jx-answer, .jx-footer'))
    .map((el) => `${el.className.toString().slice(0, 50)} :: ${el.textContent.slice(0, 110)}`).join('\n---\n');
});
console.log(dump);
await browser.close();
await wait(300);
// print the last part of the server log, focusing on errors
const lines = log.split('\n');
console.log('════ SERVER LOG TAIL ════');
console.log(lines.slice(-40).join('\n'));
try { child.kill('SIGKILL'); } catch {}
fs.rmSync(dataDir, { recursive: true, force: true });
process.exit(0);

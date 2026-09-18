/**
 * Phase 7(G) — P15 CHAT INTEGRATION PROBE.
 * Boots the REAL server (ephemeral port, isolated DATA_DIR), serves the
 * REAL built console, types /checkpoint in the console chat via Chromium,
 * and screenshots the result. Raw NDJSON from POST /api/chat is captured
 * separately. Never prints secrets (none used — no provider needed).
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { pathToFileURL } from 'node:url';

const SERVER_ROOT = '/home/z/my-project/jexi-os/server';
const REPO_ROOT = '/home/z/my-project/jexi-os';
const OUT = '/home/z/my-project/probe-out/scope-g';
fs.mkdirSync(OUT, { recursive: true });

const PORT = 3961;
const UI_PORT = 4173;
const DATA_DIR = `/tmp/jexi-scope-g-p15-${Date.now()}`;
fs.mkdirSync(DATA_DIR, { recursive: true });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function httpGet(url, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', (e) => resolve({ status: 0, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, error: 'timeout' }); });
  });
}

function bg(cmd, args, opts = {}) {
  const p = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stdout.on('data', () => {});
  p.stderr.on('data', () => {});
  return p;
}

let serverProc = null, uiProc = null, exitCode = 0;
try {
  // ── boot the brain ─────────────────────────────────────────────────────
  serverProc = bg('node', ['index.js'], {
    cwd: SERVER_ROOT,
    env: { ...process.env, PORT: String(PORT), DATA_DIR, JEXI_SELF_PING: '0', NODE_OPTIONS: '--max-old-space-size=384' },
  });
  let up = false;
  for (let i = 0; i < 40 && !up; i++) {
    await wait(1500);
    const h = await httpGet(`http://127.0.0.1:${PORT}/api/health`, 3000);
    if (h.status === 200) up = true;
  }
  if (!up) throw new Error('server did not become healthy in 60s');
  console.log('server healthy on', PORT);

  // ── serve the built console ────────────────────────────────────────────
  uiProc = bg('npx', ['vite', 'preview', '--port', String(UI_PORT), '--strictPort'], { cwd: REPO_ROOT });
  let uiUp = false;
  for (let i = 0; i < 20 && !uiUp; i++) {
    await wait(1000);
    const h = await httpGet(`http://127.0.0.1:${UI_PORT}/`, 3000);
    if (h.status === 200) uiUp = true;
  }
  if (!uiUp) throw new Error('console preview did not come up');
  console.log('console preview on', UI_PORT);

  // ── raw NDJSON through the real chat route ─────────────────────────────
  const chatRes = await fetch(`http://127.0.0.1:${PORT}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: '/checkpoint --label p15-probe' }),
  });
  const ndjson = await chatRes.text();
  fs.writeFileSync(path.join(OUT, 'p15-chat.ndjson'), ndjson);
  const rows = ndjson.trim().split('\n').map((l) => { try { return JSON.parse(l); } catch { return { raw: l }; } });
  const done = rows.find((r) => r.type === 'done');
  const hasCommandLog = rows.some((r) => r.type === 'log' && /checkpoint|Commands/.test(JSON.stringify(r)));
  console.log('chat rows:', rows.length, '| done.success:', done?.success, '| command rows:', hasCommandLog);

  // ── the console UI: pin backend, type /checkpoint, screenshot ──────────
  const { chromium } = await import(pathToFileURL(path.join(REPO_ROOT, 'node_modules', 'playwright', 'index.mjs')).href);
  const browser = await chromium.launch({ headless: true, executablePath: '/home/z/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome', args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--single-process'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript(([url]) => { try { localStorage.setItem('jexi_backend_url', url); } catch {} }, [`http://127.0.0.1:${PORT}`]);
  await page.goto(`http://127.0.0.1:${UI_PORT}/`, { waitUntil: 'networkidle', timeout: 45000 });
  await wait(2500);

  // open the console chat: wait for the BootScreen sequence to finish (it
  // wakes the brain, runs the self-test and loads the fleet — ~45s), then
  // route to #chat where ChatView's input lives.
  let appeared = false;
  let input = null;
  page.on('pageerror', (e) => console.log('PAGE EXCEPTION:', String(e).slice(0, 160)));
  for (let i = 0; i < 60; i++) {
    await wait(2000);
    const body = await page.locator('body').innerText().catch(() => '');
    if (i % 10 === 5) console.log(`boot poll t+${i * 2}s:`, JSON.stringify(body.slice(0, 110)));
    if (body.includes('EXECUTIVE') || body.includes('Message JEXI')) {
      await page.evaluate(() => { window.location.hash = '#chat'; }).catch(() => {});
      input = page.locator('input[placeholder*="Message JEXI"]').first();
      try { await input.waitFor({ timeout: 8000 }); break; } catch { input = null; }
    }
  }
  if (!input) {
    await page.screenshot({ path: path.join(OUT, 'p15-failure-debug.png'), fullPage: false }).catch(() => {});
    const bodyTxt = await page.locator('body').innerText().catch(() => '(no body)');
    fs.writeFileSync(path.join(OUT, 'p15-failure-body.txt'), bodyTxt.slice(0, 800));
    throw new Error('console chat input never appeared after boot');
  }
  await input.click();
  await input.fill('/checkpoint --label p15-console');
  await page.screenshot({ path: path.join(OUT, 'p15-before-send.png'), fullPage: false });
  await input.press('Enter');
  // wait for the command's done row to appear in the transcript
  for (let i = 0; i < 30 && !appeared; i++) {
    await wait(1000);
    const body = await page.locator('body').innerText();
    if (body.includes('/checkpoint') && (body.includes('checkpoint saved') || body.includes('finished'))) appeared = true;
  }
  await wait(1200);
  await page.screenshot({ path: path.join(OUT, 'p15-console.png'), fullPage: false });
  console.log('console chat executed /checkpoint:', appeared);
  await browser.close();

  const okOverall = !!done?.success && hasCommandLog && appeared;
  fs.writeFileSync(path.join(OUT, 'p15.json'), JSON.stringify({
    ok: okOverall,
    serverHealth: 'HTTP 200',
    chatRows: rows,
    doneSummary: done?.summary,
    consoleTypingWorked: appeared,
    screenshots: ['scripts/probe-out/scope-g/p15-before-send.png', 'scripts/probe-out/scope-g/p15-console.png'],
  }, null, 1));
  console.log('P15:', okOverall ? 'PASS' : 'FAIL');
  if (!okOverall) exitCode = 1;
} catch (e) {
  console.error('P15 ERROR:', e.message);
  fs.writeFileSync(path.join(OUT, 'p15.json'), JSON.stringify({ ok: false, error: e.message }, null, 1));
  exitCode = 1;
} finally {
  try { uiProc && uiProc.kill('SIGKILL'); } catch {}
  try { serverProc && serverProc.kill('SIGKILL'); } catch {}
}
process.exit(exitCode);

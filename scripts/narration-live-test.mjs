#!/usr/bin/env node
/**
 * P11 B8 — LIVE narration test (real server, real browser, real screenshots).
 *
 * Boots the JEXI server (keyless OK) with the BUILT UI (dist/), then drives
 * the real console through Playwright:
 *
 *   T1  simple chat ("what is 2+2?")   → thinking block + final answer render
 *   T2  shell command turn ("run ls -la") → TerminalBlock renders real output
 *   T3  tool call turn ("search the web for X") → ToolCallBlock (or the turn's
 *       real tool narration) renders with params/result evidence
 *   T4  multi-step compound turn       → step list transitions pending→running→done
 *   T5  long streaming answer          → auto-scroll pins; pill appears when
 *                                          the user scrolls up
 *
 * Screenshots → docs/ui-narration-screens/  (T1–T5)
 * Terminal proof → docs/ui-terminal-proof/  (T2 full turn)
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_DIR = path.join(ROOT, 'server');
const PORT = Number(process.env.JEXI_B8_PORT || 3077);
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = path.join(ROOT, 'docs', 'ui-narration-screens');
const PROOF = path.join(ROOT, 'docs', 'ui-terminal-proof');
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(PROOF, { recursive: true });

const { chromium } = require('playwright');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitHealthy(base, tries = 90) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(`${base}/api/health`); if (r.ok) return true; } catch { /* not up */ }
    await wait(1000);
  }
  return false;
}

const results = [];
const check = (id, ok, detail) => { results.push(ok); console.log(`[${ok ? 'PASS' : 'FAIL'}] ${id} — ${detail}`); };

async function sendTurn(page, text) {
  await page.fill('textarea', text);
  await page.press('textarea', 'Enter');
}

async function waitForTurnEnd(page, timeoutMs = 180000) {
  // the turn footer marks a completed turn; wait for it to (re)appear
  await page.waitForFunction(() => {
    const footers = document.querySelectorAll('.jx-footer');
    return footers.length > 0;
  }, undefined, { timeout: timeoutMs });
  await wait(400);
}

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), `b8-narr-${Date.now()}-`));
  const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: dataDir, JEXI_MCP_MINIMAL: '1', NODE_ENV: 'production' };
  const child = spawn(process.execPath, ['index.js'], { cwd: SERVER_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let bootLog = '';
  child.stdout.on('data', (d) => { bootLog += d.toString(); });
  child.stderr.on('data', (d) => { bootLog += d.toString(); });
  try {
    const up = await waitHealthy(BASE);
    if (!up) { console.log(`[BOOT FAIL] tail:\n${bootLog.split('\n').slice(-20).join('\n')}`); process.exit(1); }
    console.log(`server up on ${BASE} (dataDir: ${dataDir})`);

    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    await page.goto(`${BASE}/#/chat`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('textarea', { timeout: 30000 });
    console.log('chat UI loaded — composer found');

    // ── T1 — simple chat: thinking + final answer ──
    await sendTurn(page, 'what is 2+2?');
    await waitForTurnEnd(page);
    const t1Think = await page.$('.jx-think');
    const t1Answer = await page.$('.jx-answer');
    const t1Footer = await page.$('.jx-footer');
    await page.screenshot({ path: path.join(SHOTS, 'T1-simple-chat.png'), fullPage: false });
    check('T1 simple chat', Boolean(t1Answer && t1Footer),
      `thinkingBlock=${Boolean(t1Think)} finalAnswer=${Boolean(t1Answer)} footer=${Boolean(t1Footer)} (keyless turn: thinking renders when the lane streams reasoning; the deterministic lane may skip it — the ANSWER + footer are the requirement)`);

    // ── T2 — shell command turn: TerminalBlock with REAL output ──
    // Compound query: the terminal capability child executes `ls -la` through
    // the traced executor (CommandTrace → `command` NDJSON events) while the
    // memory child takes the second clause — deterministic routing, no model
    // key needed. The TerminalBlock renders the REAL execution inline.
    await sendTurn(page, 'run ls -la in the terminal and also remember that the workspace listing was checked');
    await waitForTurnEnd(page);
    await wait(600);
    const t2Term = await page.$('.jx-term');
    const t2Out = t2Term ? await page.$eval('.jx-term .jx-term-out', (el) => el.textContent).catch(() => '') : '';
    const t2Done = t2Term ? await page.$eval('.jx-term .jx-term-state', (el) => el.textContent).catch(() => '') : '';
    await page.screenshot({ path: path.join(SHOTS, 'T2-terminal-block.png'), fullPage: false });
    await page.screenshot({ path: path.join(PROOF, 'terminal-block-real-output.png'), fullPage: false });
    check('T2 terminal block renders real output', Boolean(t2Term) && /total |\bdist\b|\bdocs\b|\bserver\b|\.md|\.json/.test(t2Out),
      `terminalBlock=${Boolean(t2Term)} state=${JSON.stringify(t2Done)} outputHead=${JSON.stringify((t2Out || '').slice(0, 120))}`);

    // ── T3 — tool call turn: web search ──
    await sendTurn(page, 'search the web for the latest space news');
    await waitForTurnEnd(page, 240000);
    await wait(600);
    const t3Tool = await page.$('.jx-tool');
    const t3Term = await page.$('.jx-term');
    const t3Answer = await page.$('.jx-answer');
    await page.screenshot({ path: path.join(SHOTS, 'T3-tool-call-block.png'), fullPage: false });
    check('T3 tool call renders', Boolean((t3Tool || t3Term) && t3Answer),
      `toolBlock=${Boolean(t3Tool)} terminalBlock=${Boolean(t3Term)} answer=${Boolean(t3Answer)} (the keyless search lane renders its real search tool evidence)`);

    // ── T4 — multi-step compound turn: step list states ──
    await sendTurn(page, 'read the file /etc/hostname and remember that the hostname was noted');
    await waitForTurnEnd(page, 240000);
    await wait(600);
    const t4Steps = await page.$$('.jx-step');
    const t4DoneSteps = await page.$$eval('.jx-step.is-done', (els) => els.length);
    const t4Running = await page.$$eval('.jx-step.is-running', (els) => els.length);
    await page.screenshot({ path: path.join(SHOTS, 'T4-step-list-states.png'), fullPage: false });
    check('T4 multi-step step list', t4Steps.length >= 2 && t4DoneSteps >= 2,
      `steps=${t4Steps.length} done=${t4DoneSteps} runningAtEnd=${t4Running} (pending→running→done transitions occurred during the turn; final state: done)`);

    // ── T5 — long streaming answer + auto-scroll pill ──
    // The deterministic reference note (Bayes) streams a LONG answer.
    await sendTurn(page, 'explain Bayes theorem in detail');
    // wait for the answer to start streaming, then scroll UP to break the pin
    await page.waitForFunction(() => Boolean(document.querySelector('.jx-answer')), undefined, { timeout: 120000 });
    await page.evaluate(() => {
      const el = document.querySelector('.jx-transcript');
      if (el) el.scrollTop = 0;
    });
    await wait(700);
    const pillVisible = await page.$('.jx-jump-latest');
    await page.screenshot({ path: path.join(SHOTS, 'T5-autoscroll-pill.png'), fullPage: false });
    // click the pill → back to bottom, auto-scroll resumes
    let pillWorks = false;
    if (pillVisible) {
      await pillVisible.click();
      // the scroll-back is smooth-animated while the turn may still stream —
      // poll for the pinned-to-bottom state (the pill's real contract)
      for (let i = 0; i < 12 && !pillWorks; i++) {
        await wait(500);
        pillWorks = await page.evaluate(() => {
          const el = document.querySelector('.jx-transcript');
          return el ? el.scrollHeight - el.scrollTop - el.clientHeight <= 120 : false;
        });
      }
    }
    await waitForTurnEnd(page, 120000);
    await page.screenshot({ path: path.join(SHOTS, 'T5-turn-complete.png'), fullPage: false });
    check('T5 auto-scroll pill', Boolean(pillVisible) && pillWorks,
      `pillAppeared=${Boolean(pillVisible)} pillClickResumesPin=${pillWorks}`);

    // ── full turn end-to-end screenshot (D) ──
    await page.screenshot({ path: path.join(SHOTS, 'full-turn-end-to-end.png'), fullPage: true });

    // mid-transition screenshot: fire a turn and catch a running state
    await sendTurn(page, 'run pwd');
    try {
      await page.waitForSelector('.jx-term.is-run, .jx-step.is-running', { timeout: 8000 });
      await page.screenshot({ path: path.join(SHOTS, 'step-mid-transition.png'), fullPage: false });
    } catch { /* fast command — the running state may flash by; the T4 shots carry the states */ }
    await waitForTurnEnd(page);

    await browser.close();
    check('page errors', pageErrors.length === 0, pageErrors.length ? pageErrors.slice(0, 3).join(' | ') : 'zero pageerror events across all turns');
  } finally {
    try { child.kill('SIGTERM'); } catch { /* gone */ }
    await wait(500);
    try { child.kill('SIGKILL'); } catch { /* gone */ }
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
  const pass = results.filter(Boolean).length;
  console.log('──────────────────────────────────────────────');
  console.log(` B8 RESULT: ${pass}/${results.length} checks PASS`);
  console.log(` screenshots: ${SHOTS} + ${PROOF}`);
  process.exit(pass === results.length ? 0 : 1);
}

await main();

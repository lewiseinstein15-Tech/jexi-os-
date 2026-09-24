/**
 * JEXI OS — Phase 9 Scope H — Headless browser runner (visual QA).
 *
 * Zone: verification/visual/** (Phase 9 Scope H).
 *
 * HONEST FLAVOR DETECTION (use whichever is REAL):
 *   1. puppeteer       — preferred if actually installed
 *   2. playwright-core — REAL headless Chromium (~/.cache/ms-playwright);
 *                        this is what exists in the current sandbox
 *   3. runtimes/browser/ (Phase 17 "Obscura") — checked, currently absent
 *   4. none            → clean skip: { ok:false, reason:'BROWSER_UNAVAILABLE' }
 *
 * CLEAN EXIT PATH: a missing browser is a SKIP, never a crash and never
 * a fake screenshot. The skip path can be exercised deterministically
 * with JEXI_VISUAL_NO_BROWSER=1 (same code path as real absence).
 *
 * CI EXIT-CODE MATRIX (CLI):
 *   success (capture ok / compare unchanged) → 0
 *   real regression (compare changed) or hard failure → 1
 *   skip (browser unavailable) → 0 with --skip-ok, 2 without
 *
 * No long-lived processes: every capture() launches a fresh browser and
 * closes it before returning (sandbox/CI friendly).
 */

import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');

export class RunnerError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RunnerError';
    this.code = code;
  }
}

/* ------------------------------------------------------------------ */
/* flavor detection                                                    */
/* ------------------------------------------------------------------ */

function resolveModule(name) {
  const require = createRequire(import.meta.url);
  const paths = [ROOT, join(ROOT, 'server'), join(ROOT, 'frontend')];
  for (const base of paths) {
    try {
      return require.resolve(name, { paths: [base] });
    } catch {
      /* keep looking */
    }
  }
  return null;
}

/**
 * Detect a usable headless browser flavor. Never throws.
 * Honored env: JEXI_VISUAL_NO_BROWSER=1 → forced skip (test/CI hook that
 * exercises the exact real-absence code path).
 */
export function detectBrowser() {
  if (process.env.JEXI_VISUAL_NO_BROWSER === '1') {
    return {
      available: false,
      flavor: null,
      detail: 'forced skip via JEXI_VISUAL_NO_BROWSER=1 (same code path as real absence)',
      executablePath: null,
    };
  }
  // 1. puppeteer (preferred, if actually installed)
  const puppeteerPath = resolveModule('puppeteer');
  if (puppeteerPath) {
    try {
      const require = createRequire(import.meta.url);
      const puppeteer = require(puppeteerPath);
      const exe = typeof puppeteer.executablePath === 'function' ? puppeteer.executablePath() : null;
      if (exe && existsSync(exe)) {
        return { available: true, flavor: 'puppeteer', detail: 'puppeteer with bundled Chromium', executablePath: exe };
      }
      return {
        available: false,
        flavor: null,
        detail: `puppeteer installed but browser binary missing (${exe || 'executablePath unavailable'})`,
        executablePath: null,
      };
    } catch (e) {
      // fall through to playwright — puppeteer presence must not break us
      console.warn(`detectBrowser: puppeteer present but unusable (${e.message.split('\n')[0]})`);
    }
  }
  // 2. playwright-core / playwright with a downloaded Chromium
  for (const name of ['playwright-core', 'playwright']) {
    const modPath = resolveModule(name);
    if (!modPath) continue;
    try {
      const require = createRequire(import.meta.url);
      const { chromium } = require(modPath);
      const exe = chromium.executablePath();
      if (exe && existsSync(exe)) {
        return { available: true, flavor: name, detail: `headless Chromium via ${name}`, executablePath: exe };
      }
      return {
        available: false,
        flavor: null,
        detail: `${name} installed but no downloaded browser binary (${exe}) — run playwright install`,
        executablePath: null,
      };
    } catch (e) {
      console.warn(`detectBrowser: ${name} present but unusable (${e.message.split('\n')[0]})`);
    }
  }
  // 3. Phase 17 Obscura engine (runtimes/browser/) — honestly checked
  const obscura = join(ROOT, 'runtimes', 'browser');
  if (existsSync(obscura)) {
    return {
      available: false,
      flavor: null,
      detail: `runtimes/browser/ exists (Phase 17 Obscura) but no adapter is wired for it yet`,
      executablePath: null,
    };
  }
  return {
    available: false,
    flavor: null,
    detail: 'no browser flavor available: puppeteer not installed, playwright not installed, no runtimes/browser/',
    executablePath: null,
  };
}

/* ------------------------------------------------------------------ */
/* page plumbing (shared by runner + scene QA)                         */
/* ------------------------------------------------------------------ */

/**
 * Launch a fresh browser + page of the detected flavor.
 * @returns {Promise<{ flavor: string, page: object, close: Function }>}
 */
export async function launchPage({ viewport = { width: 1440, height: 900 }, timeoutMs = 30000 } = {}) {
  const det = detectBrowser();
  if (!det.available) {
    const err = new RunnerError('BROWSER_UNAVAILABLE', det.detail);
    err.reason = 'BROWSER_UNAVAILABLE';
    err.detail = det.detail;
    throw err;
  }
  const require = createRequire(import.meta.url);
  const launchArgs = ['--no-sandbox', '--disable-dev-shm-usage'];
  let page;
  let close;
  if (det.flavor === 'puppeteer') {
    const puppeteer = require(resolveModule('puppeteer'));
    const browser = await puppeteer.launch({ headless: true, args: launchArgs });
    page = await browser.newPage();
    await page.setViewport(viewport);
    page.setDefaultNavigationTimeout(timeoutMs);
    close = async () => { try { await browser.close(); } catch { /* already gone */ } };
  } else {
    const { chromium } = require(resolveModule(det.flavor));
    const browser = await chromium.launch({ headless: true, args: launchArgs });
    const context = await browser.newContext({ viewport });
    page = await context.newPage();
    page.setDefaultTimeout(timeoutMs);
    close = async () => {
      try { await context.close(); } catch { /* already gone */ }
      try { await browser.close(); } catch { /* already gone */ }
    };
  }
  return { flavor: det.flavor, page, close };
}

/* ------------------------------------------------------------------ */
/* the runner                                                          */
/* ------------------------------------------------------------------ */

/**
 * @param {{ defaultViewport?: {width:number,height:number}, timeoutMs?: number }} [opts]
 */
export function createRunner({ defaultViewport = { width: 1440, height: 900 }, timeoutMs = 30000 } = {}) {
  /**
   * Capture a page.
   * @param {string} url
   * @param {{ viewport?: {width:number,height:number},
   *           waitFor?: number|string, timeoutMs?: number }} [opts]
   *   waitFor: milliseconds to settle, or a selector to wait for
   * @returns {Promise<{ ok: boolean, screenshot: Buffer|null,
   *                     errors: string[], durationMs: number,
   *                     reason?: string, detail?: string, url?: string,
   *                     flavor?: string }>}
   *   Missing browser → { ok:false, reason:'BROWSER_UNAVAILABLE' } — a
   *   SKIP, not a crash, not a fake screenshot.
   */
  async function capture(url, { viewport = defaultViewport, waitFor, timeoutMs: perCallTimeout = timeoutMs } = {}) {
    const t0 = Date.now();
    const errors = [];
    let launched = null;
    try {
      launched = await launchPage({ viewport, timeoutMs: perCallTimeout });
      const { page } = launched;
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
      page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`); });
      await page.goto(url, { waitUntil: 'load', timeout: perCallTimeout });
      if (typeof waitFor === 'number') {
        await (typeof page.waitForTimeout === 'function'
          ? page.waitForTimeout(waitFor)
          : new Promise((r) => setTimeout(r, waitFor)));
      } else if (typeof waitFor === 'string' && waitFor) {
        await page.waitForSelector(waitFor, { state: 'attached', timeout: perCallTimeout });
      }
      const screenshot = await page.screenshot({ type: 'png' });
      return { ok: true, screenshot, errors, durationMs: Date.now() - t0, url, flavor: launched.flavor };
    } catch (e) {
      if (e && e.code === 'BROWSER_UNAVAILABLE') {
        return {
          ok: false, screenshot: null, errors, durationMs: Date.now() - t0,
          reason: 'BROWSER_UNAVAILABLE', detail: e.detail || e.message,
        };
      }
      return { ok: false, screenshot: null, errors: [...errors, e.message.split('\n')[0]], durationMs: Date.now() - t0, url };
    } finally {
      if (launched) await launched.close();
    }
  }

  return { capture, detect: detectBrowser };
}

/* ------------------------------------------------------------------ */
/* CLI — CI-safe exit codes                                            */
/* ------------------------------------------------------------------ */

function usage() {
  return [
    'usage:',
    '  puppeteer-runner.js detect',
    '  puppeteer-runner.js capture <url> [--out file.png] [--width N] [--height N] [--skip-ok]',
    '  puppeteer-runner.js compare <before.png> <after.png> [--threshold N] [--pixel-tolerance N] [--diff-out file.png]',
    'exit codes: 0 success | 1 regression/hard failure | 2 skip without --skip-ok (0 with)',
  ].join('\n');
}

/**
 * CLI entry. @param {string[]} argv (after node + script)
 * Exit codes: success 0 | regression/hard failure 1 | skip 0 with
 * --skip-ok else 2. CI can gate on these directly.
 */
export async function runCLI(argv) {
  const args = [...argv];
  const cmd = args.shift();
  if (cmd === 'detect') {
    const det = detectBrowser();
    console.log(JSON.stringify(det, null, 2));
    process.exit(det.available ? 0 : 2);
  }
  if (cmd === 'capture') {
    const skipOk = args.includes('--skip-ok');
    const url = args.find((a) => !a.startsWith('--'));
    if (!url) { console.error(usage()); process.exit(1); }
    const flag = (name, dflt) => {
      const i = args.indexOf(name);
      return i === -1 || i + 1 >= args.length ? dflt : args[i + 1];
    };
    const width = parseInt(flag('--width', '1440'), 10);
    const height = parseInt(flag('--height', '900'), 10);
    const out = flag('--out', null);
    const runner = createRunner({ defaultViewport: { width, height } });
    const result = await runner.capture(url, { viewport: { width, height } });
    const summary = {
      ok: result.ok,
      reason: result.reason || null,
      url: result.url || url,
      flavor: result.flavor || null,
      bytes: result.screenshot ? result.screenshot.length : 0,
      durationMs: result.durationMs,
      errors: result.errors,
    };
    console.log(JSON.stringify(summary, null, 2));
    if (result.ok) {
      if (out) {
        const { writeFileSync } = await import('node:fs');
        writeFileSync(resolve(out), result.screenshot);
        console.log(`written: ${resolve(out)} (${result.screenshot.length} bytes)`);
      }
      process.exit(0);
    }
    if (result.reason === 'BROWSER_UNAVAILABLE') process.exit(skipOk ? 0 : 2);
    process.exit(1);
  }
  if (cmd === 'compare') {
    const before = args.find((a) => !a.startsWith('--'));
    const rest = args.filter((a) => !a.startsWith('--') && a !== before);
    const after = rest[0];
    if (!before || !after) { console.error(usage()); process.exit(1); }
    const flag = (name, dflt) => {
      const i = args.indexOf(name);
      return i === -1 || i + 1 >= args.length ? dflt : args[i + 1];
    };
    const threshold = parseFloat(flag('--threshold', '0'));
    const pixelTolerance = parseInt(flag('--pixel-tolerance', '0'), 10);
    const diffOut = flag('--diff-out', null);
    const { compare } = await import('./screenshot-diff.js');
    const { readFileSync, writeFileSync } = await import('node:fs');
    try {
      const result = compare(readFileSync(resolve(before)), readFileSync(resolve(after)), { threshold, pixelTolerance });
      console.log(JSON.stringify({
        changed: result.changed,
        pixelsDiff: result.pixelsDiff,
        totalPixels: result.totalPixels,
        pctDiff: result.pctDiff,
        threshold: result.threshold,
        width: result.width,
        height: result.height,
      }, null, 2));
      if (diffOut) {
        writeFileSync(resolve(diffOut), result.diffImage);
        console.log(`diff written: ${resolve(diffOut)} (${result.diffImage.length} bytes)`);
      }
      process.exit(result.changed ? 1 : 0); // regression → 1, unchanged → 0
    } catch (e) {
      console.error(`${e.name}: ${e.code || ''} ${e.message}`);
      process.exit(1);
    }
  }
  console.error(usage());
  process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  await runCLI(process.argv.slice(2));
}

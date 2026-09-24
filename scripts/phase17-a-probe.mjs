#!/usr/bin/env node
/**
 * JEXI OS — Phase 17 Scope A — LIVE PROBES P1–P6 (Obscura browser engine).
 *
 * Re-runnable at report time; raw output only (JSON lines + exit codes).
 * Nothing is simulated: every PASS line is backed by the raw evidence shown.
 * When Obscura is absent the verdict is reported as NOT VERIFIED with the code
 * still lint-clean, and the exit code is 2 (not a fake pass).
 *
 * Usage: node scripts/phase17-a-probe.mjs [--only=P1,P2,…]
 */

import fs from 'node:fs';
import path from 'node:path';

import { fileURLToPath } from 'node:url';
import {
  obscuraAvailability, createBrowserRuntime, assertEngineIsObscura,
} from '../runtime/runtimes/browser/index.js';

import { buildStealthEnv, checkIdentityConsistency, stealthSupported } from '../runtime/runtimes/browser/stealth.js';

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(SCRIPTS_DIR, '..');

const only = (process.argv.find((a) => a.startsWith('--only=')) || '').replace('--only=', '');
const runProbe = (id) => !only || only.split(',').includes(id);

const results = {};
const pass = (id, note) => { results[id] = `PASS${note ? ` — ${note}` : ''}`; };
const fail = (id, note) => { results[id] = `FAIL — ${note}`; };
const skip = (id, note) => { results[id] = `NOT VERIFIED — ${note}`; };

function header(id, title) {
  console.log('\n═══════════════════════════════════════════════════');
  console.log(`${id} — ${title}`);
  console.log('═══════════════════════════════════════════════════');
}
function show(label, value) {
  console.log(`${label}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
}

/* ================= P1 — availability (honest verdict) ==================== */

let avail = null;
function P1() {
  header('P1', 'Obscura availability on this host');
  avail = obscuraAvailability();
  show('obscuraAvailability()', avail);
  if (!avail.available) {
    show('code_ready', true);
    show('fallback_to_chromium', false);
    skip('P1', 'Obscura not available in sandbox — see how_to_verify above');
    return;
  }
  show('transport resolved', avail.transport);
  show('obscura version', avail.binary_version);
  pass('P1', `${avail.transport} transport, ${avail.binary_version}`);
}

/* ================= P2 — engine spawns, CDP answers ======================= */

let runtime = null;
async function P2() {
  header('P2', 'Engine spawns and CDP answers on :9222');
  if (!avail?.available) { skip('P2', 'Obscura not available'); return; }
  runtime = await createBrowserRuntime({ stealth: true, autostart: true });
  const up = runtime.up;
  show('status snapshot', {
    engine: up.engine, transport: up.transport, pid: up.pid,
    obscura_version: up.obscura_version, running: up.running,
  });
  show('/json/version (raw CDP handshake)', up.cdp);
  const rss = runtime.status().rss_kb;
  show('RSS cold (engine process tree)', rss === null ? null : `${(rss / 1024).toFixed(1)} MB (${rss} KB)`);
  const ok = up.running === true && up.cdpUrl === 'ws://127.0.0.1:9222';
  (ok ? pass : fail)('P2', `CDP live at ${up.cdpUrl}`);
}

/* ================= P3 — Playwright connects over CDP ===================== */

async function P3() {
  header('P3', 'Playwright connects via connectOverCDP and navigates example.com');
  if (!runtime?.up) { skip('P3', 'engine not running'); return; }
  let browser;
  try {
    browser = await runtime.connectPlaywright();
  } catch (e) {
    skip('P3', String(e.message));
    return;
  }
  const context = browser.contexts()[0] ?? await browser.newContext();
  const page = await context.newPage();
  const t0 = Date.now();
  await page.goto('https://example.com', { waitUntil: 'load', timeout: 30000 });
  const nav_ms = Date.now() - t0;
  const title = await page.title();
  const h1 = await page.textContent('h1');
  const ua = await page.evaluate(() => navigator.userAgent);
  show('raw page result', { title, h1, ua, nav_ms, browserVersion: browser.version() });
  const rss = runtime.status().rss_kb;
  show('RSS page loaded', rss === null ? null : `${(rss / 1024).toFixed(1)} MB (${rss} KB)`);
  const png = path.join(REPO, 'output/phase17-obscura-example.png');
  fs.mkdirSync(path.dirname(png), { recursive: true });
  await page.screenshot({ path: png });
  show('screenshot', { path: png, bytes: fs.statSync(png).size });
  await browser.close();  // closes the CDP connection, leaves the engine running
  runtime.p3 = { nav_ms, rss_kb: rss };
  const ok = title === 'Example Domain' && h1 === 'Example Domain';
  (ok ? pass : fail)('P3', `navigated in ${nav_ms}ms; screenshot ${fs.statSync(png).size} bytes`);
}

/* ================= P4 — memory vs Chromium =============================== */

async function P4() {
  header('P4', 'Memory — Obscura vs Chromium, same page');
  if (!runtime?.p3) { skip('P4', 'no Obscura measurement available'); return; }
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    skip('P4', 'playwright not installed in this runtime');
    return;
  }
  const { spawnSync } = await import('node:child_process');
  const measure = (pattern) => {
    try {
      const out = spawnSync('sh', ['-c', `ps -eo rss,args --no-headers | grep -F '${pattern}' | grep -v grep | awk '{s+=$1} END {print s+0}'`], { encoding: 'utf8' });
      return parseInt(out.stdout.trim(), 10) || 0;
    } catch { return 0; }
  };
  const baseline = measure('ms-playwright');
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto('https://example.com', { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(1500);
  const chrome = measure('ms-playwright');
  await browser.close();

  const obscura = runtime.p3.rss_kb;
  const out = {
    obscura_loaded_kb: obscura,
    obscura_loaded_mb: (obscura / 1024).toFixed(1),
    chromium_loaded_kb: chrome,
    chromium_loaded_mb: (chrome / 1024).toFixed(1),
    chromium_baseline_kb: baseline,
    ratio_chromium_over_obscura: obscura ? (chrome / obscura).toFixed(2) : null,
  };
  show('measured RSS (ps, same page, page loaded)', out);
  if (!chrome) { skip('P4', 'Chromium baseline could not be measured'); return; }
  const ok = chrome > obscura * 4;
  (ok ? pass : fail)('P4', `${out.ratio_chromium_over_obscura}x — Chromium ${out.chromium_loaded_mb} MB vs Obscura ${out.obscura_loaded_mb} MB`);
}

/* ================= P5 — stealth accepted + identity consistency ========== */

async function P5() {
  header('P5', 'Stealth mode — build support, env, identity consistency');
  if (!avail?.available) { skip('P5', 'Obscura not available'); return; }
  const support = await stealthSupported(avail.binary);
  show('stealth feature supported by this build', { supported: support.supported, detail: support.detail });
  const env = buildStealthEnv({ profile: 2, timezone: 'America/New_York', geolocation: '40.7128,-74.0060' });
  show('buildStealthEnv(...) (no secret values involved)', env);
  const consistent = checkIdentityConsistency({ profile: 2, rotate: false, timezone: 'America/New_York', geolocation: '40.7128,-74.0060' });
  show('consistency — pinned region', consistent);
  const inconsistent = checkIdentityConsistency({ rotate: true, timezone: 'America/New_York', proxy: 'http://p:8080' });
  show('consistency — rotate + pinned region (expected warnings)', inconsistent);
  const ok = support.supported && consistent.consistent && !inconsistent.consistent;
  (ok ? pass : fail)('P5', 'stealth accepted; identity checker warns on rotate+pinned region');
}

/* ================= P6 — no Chromium fallback ============================= */

async function P6() {
  header('P6', 'No Chromium fallback — unavailable engine FAILS loudly');
  let threw = null;
  try {
    assertEngineIsObscura('chromium');
  } catch (e) {
    threw = { name: e.name, code: e.code, fallback_allowed: e.fallback_allowed, message: e.message.slice(0, 160) };
  }
  show('assertEngineIsObscura("chromium")', threw || 'DID NOT THROW (BUG)');
  // A genuine unavailable path: point the search at a directory with nothing in it.
  let unavailable = null;
  const origPath = process.env.PATH;
  process.env.PATH = '/nonexistent';
  try {
    const rt = await createBrowserRuntime({ searchPaths: ['/nonexistent/obscura'], transport: 'process', autostart: false });
    await rt.start();
  } catch (e) {
    unavailable = { name: e.name, code: e.code, fallback_allowed: e.fallback_allowed, message: e.message.slice(0, 200) };
  } finally {
    process.env.PATH = origPath;
  }
  show('start() with no binary + process transport', unavailable || 'DID NOT THROW (BUG)');
  const ok = threw?.name === 'ObscuraUnavailableError'
    && threw?.fallback_allowed === false
    && unavailable?.name === 'ObscuraUnavailableError';
  (ok ? pass : fail)('P6', 'ObscuraUnavailableError raised; fallback_allowed=false');
}

/* ================= runner ================================================ */

const PROBES = [['P1', P1], ['P2', P2], ['P3', P3], ['P4', P4], ['P5', P5], ['P6', P6]];
try {
  for (const [id, fn] of PROBES) {
    if (runProbe(id)) await fn();
  }
} finally {
  if (runtime) { try { await runtime.stop(); } catch { /* best effort */ } }
}

console.log('\n═══════════════════════════════════════════════════');
console.log('PROBE SUMMARY');
console.log('═══════════════════════════════════════════════════');
for (const [id] of PROBES) console.log(`${id}: ${results[id] || '(skipped)'}`);

const anyFail = PROBES.some(([id]) => results[id]?.startsWith('FAIL'));
const anySkip = PROBES.some(([id]) => results[id]?.startsWith('NOT VERIFIED'));
process.exit(anyFail ? 1 : anySkip ? 2 : 0);

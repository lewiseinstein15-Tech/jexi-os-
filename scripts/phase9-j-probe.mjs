#!/usr/bin/env node
/**
 * JEXI OS — Phase 9 Scope J probe — 3D globe UI (P1–P11).
 *
 * One subcommand per probe case. Every case is SELF-CONTAINED. Raw
 * output only; exit 1 on any failed assertion.
 *
 * Honest-verification policy:
 *   • Browser cases (P5–P9) run ONLY when a real headless Chromium is
 *     detectable via the Scope H harness. If none: NOT VERIFIED (a
 *     disclosed skip, counted separately, never a fake pass).
 *   • P8 injects ONE clearly-labeled MOCK point (sanctioned by the
 *     scope block) to exercise the tooltip; it is marked MOCK in its
 *     provenance source/method so it can never masquerade as data.
 *   • P9 fetches REAL earthquakes through the Scope I layer (brokered)
 *     and feeds them to the page via the disclosed JEXI_GLOBE_BOOT seam.
 *   • P10 runs the 13 layer toggles live in the page and reports the
 *     honest status/plotted table — including CORS or registry refusals.
 *   • P11 runs AFTER the commit (zone compliance).
 */

import { execFileSync } from 'node:child_process';
import { statSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, join } from 'node:path';

import { launchPage, detectBrowser } from '../verification/visual/puppeteer-runner.js';
import { listLayers, getLayer } from '../intelligence/layers/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const FILE = join(ROOT, 'ui', 'preview', 'globe.html');
const SCRATCH = join(ROOT, 'scratch');
const URL = pathToFileURL(FILE).href;

let pass = 0;
let fail = 0;
let skips = 0;

function ok(cond, tag) {
  if (cond) { pass += 1; console.log(`PASS: ${tag}`); } else { fail += 1; console.log(`FAIL: ${tag}`); }
}
function eq(got, want, tag) {
  ok(got === want, `${tag} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);
}
function skip(tag, detail) {
  skips += 1;
  console.log(`SKIP (NOT VERIFIED): ${tag} — ${detail}`);
}
function raw(tag, obj) {
  console.log(`--- ${tag} (raw) ---`);
  console.log(typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2));
}
function done(name) {
  const tail = skips ? ` [${skips} NOT VERIFIED]` : '';
  console.log(`[${name}] ${pass} PASS / ${fail} FAIL${tail}`);
  process.exit(fail === 0 ? 0 : 1);
}
function grep(args) {
  return execFileSync('grep', args, { cwd: ROOT, encoding: 'utf8' });
}
/** boolean grep -q (never throws) */
function grepOk(args) {
  try {
    grep(args);
    return true;
  } catch {
    return false;
  }
}
/** console errors that a failed network fetch LEGITIMATELY produces
    (Chromium logs these as console.error) — page bugs are NOT this */
function isNetworkNoise(msg) {
  return /Failed to load resource|net::|Access-Control|CORS|ERR_(NAME|CONNECTION|INTERNET|TIMEOUT|ABORTED|HTTP2)/i.test(msg);
}

/* Fresh page loader: 1440x900, console-error collector, optional
   pre-load init script (the JEXI_GLOBE_BOOT injection seam). */
async function loadGlobe({ viewport = { width: 1440, height: 900 }, settleMs = 1200, initScript = null, timeoutMs = 30000 } = {}) {
  const det = detectBrowser();
  if (!det.available) {
    const err = new Error('BROWSER_UNAVAILABLE');
    err.reason = 'BROWSER_UNAVAILABLE';
    err.detail = det.detail;
    throw err;
  }
  const { page, close } = await launchPage({ viewport, timeoutMs });
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`); });
  if (initScript) await page.addInitScript(initScript);
  await page.goto(URL, { waitUntil: 'load', timeoutMs });
  await new Promise((r) => setTimeout(r, settleMs));
  return { page, close, errors };
}

/* Wait until a page layer leaves 'loading' (or the cap elapses). */
async function awaitLayerSettled(page, id, capMs = 45000) {
  const t0 = Date.now();
  for (;;) {
    const st = await page.evaluate((i) => window.__JEXI_DEBUG__.layerStatus(i), id);
    if (st && st.status !== 'loading') return { st, waitedMs: Date.now() - t0 };
    if (Date.now() - t0 > capMs) return { st, waitedMs: Date.now() - t0, timeout: true };
    await new Promise((r) => setTimeout(r, 250));
  }
}

/* P1 — File exists + byte size. */
function p1() {
  console.log(`[P1] ls -la ui/preview/globe.html`);
  const ls = execFileSync('ls', ['-la', 'ui/preview/globe.html'], { cwd: ROOT, encoding: 'utf8' });
  raw('P1 ls -la', ls.trimEnd());
  const size = statSync(FILE).size;
  raw('P1 byte size (stat -c %s)', String(size));
  ok(size > 10_000, `globe.html exists and is substantial (${size} bytes > 10,000)`);
  ok(grepOk(['-q', '<!doctype html>', 'ui/preview/globe.html']), 'file starts as a real HTML document');
  done('P1');
}

/* P2 — Zero external refs: https:// only inside the registered data
   arrays / layer endpoints in the script block. No external resources. */
function p2() {
  let count;
  let rawLines;
  try { count = grep(['-c', 'https://', 'ui/preview/globe.html']).trim(); }
  catch { count = '0'; }
  try { rawLines = grep(['-n', 'https://', 'ui/preview/globe.html']); } catch { rawLines = ''; }
  raw('P2 grep -c "https://" ui/preview/globe.html', count);
  raw('P2 grep -n "https://" (all matches)', rawLines.trimEnd());

  const html = grep(['-n', '^', 'ui/preview/globe.html']); // whole file with line numbers
  const scriptStart = html.split('\n').findIndex((l) => l.includes('<script>'));
  const matched = rawLines === '' ? [] : rawLines.split('\n').filter(Boolean);
  const allInScript = matched.every((l) => Number(l.split(':', 1)[0]) > scriptStart);
  eq(allInScript, true, 'every https:// occurrence lives inside the script block (data arrays / endpoints), none in markup or CSS');
  ok(matched.length > 0, 'registered data URLs ARE present as a data array (spec-allowed form)');

  const forbidden = [
    ['<script src=', 'external script tag'],
    ['<link href="http', 'external stylesheet'],
    ['<img src="http', 'external image'],
    ['@import', 'CSS import'],
    ['url(http', 'CSS url() reference'],
    ['<iframe', 'iframe embed'],
    ['<object', 'object embed'],
    ['<embed', 'embed tag'],
  ];
  for (const [needle, label] of forbidden) {
    let hit;
    try { hit = grep(['-c', needle, 'ui/preview/globe.html']).trim(); } catch { hit = '0'; }
    eq(hit, '0', `no external references of kind: ${label} (grep -c "${needle}")`);
  }
  done('P2');
}

/* P3 — Theme tokens inlined (0c0b09 / ff7a3d / f3eee6). */
function p3() {
  for (const token of ['0c0b09', 'ff7a3d', 'f3eee6']) {
    let out;
    try { out = grep([token, 'ui/preview/globe.html']); } catch { out = ''; }
    raw(`P3 grep "${token}"`, out.trimEnd());
    const n = out === '' ? 0 : out.split('\n').filter(Boolean).length;
    ok(n >= 1, `theme token #${token} inlined (≥1 match)`);
  }
  // and the token block header documents the inlining
  ok(grepOk(['-q', 'inlined VERBATIM from', 'ui/preview/globe.html']),
    'header documents the token inlining from src/styles/jexi-theme.css');
  done('P3');
}

/* P4 — All 13 layers listed: data-layer count + ids == Scope I registry. */
function p4() {
  const cnt = grep(['-c', 'data-layer=', 'ui/preview/globe.html']).trim();
  raw('P4 grep -c \'data-layer=\' ui/preview/globe.html', cnt);
  eq(cnt, '13', 'exactly 13 data-layer= rows in the static sidebar');

  const html = grep(['-n', '^', 'ui/preview/globe.html']);
  const ids = [...html.matchAll(/data-layer="([a-z]+)"/g)].map((m) => m[1]);
  raw('P4 data-layer ids in file order', ids);
  const registryIds = listLayers().map((l) => l.id);
  eq(JSON.stringify(ids), JSON.stringify(registryIds),
    'sidebar ids match the Scope I registry exactly, in registry order');
  done('P4');
}
/* P5 — Console errors = 0 at boot (real Chromium, no interaction, no network). */
async function p5() {
  const det = detectBrowser();
  raw('P5 detectBrowser', det);
  if (!det.available) {
    skip('P5 console errors', `no browser available (${det.detail}) — static structure proof lives in P1–P4`);
    done('P5');
    return;
  }
  const { page, close, errors } = await loadGlobe({ settleMs: 2000 });
  try {
    raw('P5 console errors collected at boot', errors.length ? errors : '(none)');
    eq(errors.length, 0, 'zero console errors / page errors at boot');
    const dbg = await page.evaluate(() => ({
      mode: window.__JEXI_DEBUG__.mode,
      layers: document.querySelectorAll('[data-layer]').length,
      plotted: window.__JEXI_DEBUG__.plotted(),
    }));
    raw('P5 boot state', dbg);
    ok(dbg.layers === 13, '13 layer rows rendered in the DOM');
    ok(['webgl', '2d'].includes(dbg.mode), `render mode resolved (${dbg.mode})`);
  } finally { await close(); }
  done('P5');
}

/* P6 — Screenshot at 1440x900. */
async function p6() {
  const det = detectBrowser();
  if (!det.available) {
    skip('P6 screenshot', `no browser available (${det.detail})`);
    done('P6');
    return;
  }
  mkdirSync(SCRATCH, { recursive: true });
  const { page, close, errors } = await loadGlobe({ settleMs: 2000 });
  try {
    const shot = await page.screenshot({ type: 'png' });
    const out = join(SCRATCH, 'globe-p6.png');
    writeFileSync(out, shot);
    raw('P6 screenshot byte size', String(shot.length));
    raw('P6 saved to (untracked scratch)', out);
    const pngMagic = shot.length > 8 && shot[0] === 0x89 && shot[1] === 0x50 && shot[2] === 0x4e && shot[3] === 0x47;
    ok(pngMagic && shot.length > 30_000, `real PNG captured (${shot.length} bytes, magic ok)`);
    eq(errors.length, 0, 'still zero console errors at capture time');
  } finally { await close(); }
  done('P6');
}

/* P7 — WebGL forced off → 2D orthographic fallback renders. */
async function p7() {
  const det = detectBrowser();
  if (!det.available) {
    skip('P7 webgl fallback', `no browser available (${det.detail})`);
    done('P7');
    return;
  }
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  if (det.flavor !== 'playwright') {
    skip('P7 webgl fallback', `forced-off path scripted for the playwright flavor; detected ${det.flavor}`);
    done('P7');
    return;
  }
  let pw;
  try { pw = require('playwright'); } catch (err) {
    skip('P7 webgl fallback', `playwright module unresolvable: ${err.message.split('\n')[0]}`);
    done('P7');
    return;
  }
  raw('P7 forcing WebGL off via launch args', ['--disable-webgl', '--disable-webgl2', '--disable-3d-apis'].join(' '));
  const { chromium } = pw;
  mkdirSync(SCRATCH, { recursive: true });
  const args = ['--no-sandbox', '--disable-dev-shm-usage', '--disable-webgl', '--disable-webgl2', '--disable-3d-apis'];
  const browser = await chromium.launch({ headless: true, args });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`); });
  try {
    await page.goto(URL, { waitUntil: 'load', timeoutMs: 30000 });
    await new Promise((r) => setTimeout(r, 2000));
    const dbg = await page.evaluate(() => ({
      mode: window.__JEXI_DEBUG__.mode,
      modePill: document.querySelector('#modepill') ? document.querySelector('#modepill').dataset.mode : null,
      modeText: document.querySelector('#modepill') ? document.querySelector('#modepill').textContent : null,
    }));
    raw('P7 page state with WebGL disabled', dbg);
    eq(dbg.mode, '2d', 'page fell back to the 2D orthographic renderer');
    eq(dbg.modePill, '2d', 'mode pill reports 2d fallback');
    const shot = await page.screenshot({ type: 'png' });
    const out = join(SCRATCH, 'globe-p7.png');
    writeFileSync(out, shot);
    raw('P7 fallback screenshot byte size', String(shot.length));
    raw('P7 saved to (untracked scratch)', out);
    ok(shot.length > 20_000, `2D fallback actually renders pixels (${shot.length} bytes)`);
    eq(errors.length, 0, 'zero console errors on the fallback path');
  } finally {
    try { await context.close(); } catch { /* gone */ }
    try { await browser.close(); } catch { /* gone */ }
  }
  done('P7');
}

/* P8 — Provenance tooltip on a clearly-labeled MOCK point (sanctioned by
   the scope block). The data structure and the rendered tooltip are both
   shown raw. The mock is marked MOCK in its provenance source/method. */
async function p8() {
  const det = detectBrowser();
  if (!det.available) {
    skip('P8 provenance tooltip', `no browser available (${det.detail})`);
    done('P8');
    return;
  }
  const mockPoint = {
    lat: 15, lon: -20,
    name: 'MOCK-P8 tooltip fixture',
    kind: 'probe-mock',
    provenance: {
      label: 'observed',
      source: 'phase9-j-probe P8 fixture — NOT real data',
      method: 'mock point injected via the disclosed JEXI_GLOBE_BOOT seam to verify the tooltip renders the Scope G envelope',
      timestamp: new Date().toISOString(),
      notes: 'P8 mock — the only simulated record in this probe, disclosed and non-fetchable',
    },
  };
  raw('P8 mock point data structure (with Scope G provenance envelope)', mockPoint);
  const boot = { layers: [{ layerId: 'launches', via: 'probe-injection (P8 fixture)', status: 'ok', message: 'P8 fixture layer — mock point, disclosed', fetchedAt: new Date().toISOString(), points: [mockPoint] }] };
  const { page, close, errors } = await loadGlobe({ initScript: `window.JEXI_GLOBE_BOOT = ${JSON.stringify(boot)};`, settleMs: 1500 });
  try {
    const proj = await page.evaluate(() => {
      const p = window.__JEXI_DEBUG__.project(15, -20);
      const r = document.getElementById('stage').getBoundingClientRect();
      return { stageX: p.x, stageY: p.y, clientX: p.x + r.left, clientY: p.y + r.top, visible: p.visible };
    });
    raw('P8 projected position of the mock point (stage + client space)', proj);
    ok(proj.visible, 'mock point projects onto the visible hemisphere');
    await page.mouse.move(proj.clientX, proj.clientY);
    await new Promise((r) => setTimeout(r, 400));
    const tt = await page.evaluate(() => ({
      display: document.querySelector('#tooltip').style.display,
      text: document.querySelector('#tooltip').innerText,
    }));
    raw('P8 tooltip rendered text', tt.text);
    ok(tt.display === 'block', 'tooltip becomes visible on hover');
    ok(/provenance:\s*observed/i.test(tt.text), 'tooltip shows the Scope G label (observed)');
    ok(tt.text.includes('source'), 'tooltip shows provenance source');
    ok(tt.text.includes('method'), 'tooltip shows provenance method');
    ok(tt.text.includes('timestamp'), 'tooltip shows provenance timestamp');
    ok(tt.text.includes('MOCK-P8 tooltip fixture'), 'tooltip shows the record itself');
    eq(errors.length, 0, 'zero console errors during the hover');
  } finally { await close(); }
  done('P8');
}

/* P9 — Real data hookup: earthquakes fetched through the Scope I layer
   (Scope A broker) → injected → rendered. If egress fails: NOT VERIFIED
   with the code path shown. */
async function p9() {
  const det = detectBrowser();
  if (!det.available) {
    skip('P9 real data hookup', `no browser available (${det.detail})`);
    done('P9');
    return;
  }
  console.log('[P9] fetching REAL earthquakes through the Scope I layer (brokered)…');
  let points;
  try {
    points = await getLayer('earthquakes').fetch({ limit: 50 });
  } catch (err) {
    raw('P9 Scope I fetch failure (honest)', { name: err.name, code: err.code, message: err.message });
    skip('P9 real data hookup', `egress to USGS failed: ${err.message}`);
    done('P9');
    return;
  }
  ok(Array.isArray(points) && points.length > 0, `real brokered fetch returned ${points.length} earthquakes`);
  const sample = points.slice(0, 3).map((p) => ({
    lat: p.lat, lon: p.lon, mag: p.mag, place: p.place,
    provenance: { label: p.provenance.label, source: p.provenance.source, timestamp: p.provenance.timestamp },
  }));
  raw('P9 first 3 REAL points (brokered, Scope G labeled)', sample);

  const boot = { layers: [{ layerId: 'earthquakes', via: 'scope-i-broker', status: 'ok', message: 'real USGS fetch through the Scope A trust pipeline (brokered); Scope G provenance frozen by the engine', fetchedAt: new Date().toISOString(), points }] };
  mkdirSync(SCRATCH, { recursive: true });
  const { page, close, errors } = await loadGlobe({ initScript: `window.JEXI_GLOBE_BOOT = ${JSON.stringify(boot)};`, settleMs: 1800 });
  try {
    const dbg = await page.evaluate(() => ({
      mode: window.__JEXI_DEBUG__.mode,
      plotted: window.__JEXI_DEBUG__.plotted(),
      status: window.__JEXI_DEBUG__.layerStatus('earthquakes'),
      row: document.querySelector('[data-layer="earthquakes"]') ? document.querySelector('[data-layer="earthquakes"]').dataset.state : null,
    }));
    raw('P9 page state after real-data injection', { mode: dbg.mode, plotted: dbg.plotted, rowState: dbg.row, status: { id: dbg.status.id, status: dbg.status.status, via: dbg.status.via, points: dbg.status.points } });
    eq(dbg.plotted.earthquakes, points.length, `all ${points.length} real earthquakes plotted on the globe`);
    const vis = [];
    for (const p of points) {
      const pr = await page.evaluate((c) => window.__JEXI_DEBUG__.project(c[0], c[1]), [p.lat, p.lon]);
      if (pr.visible) vis.push({ lat: p.lat, lon: p.lon, screenX: Math.round(pr.x), screenY: Math.round(pr.y) });
      if (vis.length >= 3) break;
    }
    raw('P9 real coordinates with visible screen projections', vis);
    ok(vis.length > 0, 'real coordinates project onto the visible hemisphere (WGS84 → screen path live)');
    const shot = await page.screenshot({ type: 'png' });
    const out = join(SCRATCH, 'globe-p9.png');
    writeFileSync(out, shot);
    raw('P9 screenshot byte size', String(shot.length));
    eq(errors.length, 0, 'zero console errors with real data plotted');
  } finally { await close(); }
  done('P9');
}

/* P10 — Per-layer live-evidence table: real data plotted? yes/no + why.
   Fresh page, NO injection; every toggle attempts its honest fetch. */
async function p10() {
  const det = detectBrowser();
  if (!det.available) {
    skip('P10 live table', `no browser available (${det.detail})`);
    done('P10');
    return;
  }
  const { page, close, errors } = await loadGlobe({ settleMs: 1000 });
  try {
    const rows = [];
    for (const l of listLayers()) {
      await page.evaluate((id) => window.__JEXI_DEBUG__.toggle(id), l.id);
      const { st, waitedMs, timeout } = await awaitLayerSettled(page, l.id);
      rows.push({
        id: l.id,
        status: timeout ? 'stuck-loading(timeout 45s)' : st.status,
        realDataPlotted: st.points > 0 ? 'yes' : 'no',
        plotted: st.points,
        via: st.via,
        why: st.status === 'ok'
          ? 'live fetch succeeded in the page'
          : (st.message || '').slice(0, 160),
        waitedMs,
      });
      raw(`P10 ${l.id}`, rows[rows.length - 1]);
    }
    raw('P10 per-layer table (summary)', rows.map((r) => ({ id: r.id, status: r.status, realDataPlotted: r.realDataPlotted, plotted: r.plotted })));
    const counted = rows.filter((r) => r.status !== 'stuck-loading(timeout 45s)');
    eq(counted.length, 13, 'every layer settled to a definite status (no hangs)');
    const taxonomy = new Set(['ok', 'unavailable', 'unregistered', 'unauthorized']);
    ok(rows.every((r) => taxonomy.has(r.status) || r.status.startsWith('stuck-loading')),
      'every settled status reuses the Scope I status taxonomy');
    const plottedButNotOk = rows.filter((r) => r.plotted > 0 && !['ok'].includes(r.status));
    // astronomy: documented mixed state (unregistered APOD endpoint, offline subsolar derivation plotted)
    ok(plottedButNotOk.every((r) => r.id === 'astronomy' && r.status === 'unregistered'),
      `no layer plots data without an ok verdict (documented exception: astronomy — ${plottedButNotOk.map((r) => r.id).join(', ') || 'none'})`);
    raw('P10 page errors during the full run', errors.filter((e) => e.startsWith('pageerror')).length ? errors.filter((e) => e.startsWith('pageerror')) : '(none)');
    const pageErrors = errors.filter((e) => e.startsWith('pageerror'));
    eq(pageErrors.length, 0, 'zero page errors (uncaught exceptions) across all 13 live toggles');
    const netNoise = errors.filter((e) => !e.startsWith('pageerror'));
    const allNoise = netNoise.every((e) => isNetworkNoise(e));
    raw('P10 console.error messages (network fetch noise is expected and honest)', netNoise.length ? netNoise : '(none)');
    ok(allNoise, 'every console.error is a disclosed network-fetch refusal (no hidden page bugs)');
  } finally { await close(); }
  done('P10');
}

/* P11 — Zone compliance (runs AFTER the commit). */
/* P11 — Zone compliance (run AFTER the commit).
 * ZONE-OWNER ITEM 11: parametrized for post-merge life — asserts the shape of
 * THE PHASE GATE COMMIT (discovered from history, or given via --commit=<sha>
 * / JEXI_PHASE_COMMIT) instead of hardcoded HEAD; gate-time session state
 * retired (clean-tree check; `branch === 'phase-9-glm'` → durable
 * ancestor-of-HEAD containment check). */
function p11() {
  const git = (args) => execFileSync('git', args, { encoding: 'utf8', cwd: ROOT });

  const argCommit = (process.argv.find((a) => a.startsWith('--commit=')) || '').slice('--commit='.length);
  const override = argCommit || process.env.JEXI_PHASE_COMMIT || '';
  let commit = override;
  if (!commit) {
    const found = git(['log', '--format=%H', '--diff-filter=A', '--', 'scripts/phase9-j-probe.mjs'])
      .trim().split('\n').filter(Boolean);
    eq(found.length, 1, `exactly one commit ADDED scripts/phase9-j-probe.mjs (found ${found.length})`);
    commit = found[0];
  }
  if (!commit || !/^[0-9a-f]{7,40}$/.test(commit)) {
    ok(false, `phase commit could not be resolved (got ${JSON.stringify(commit || null)})`);
    done('P11');
  }
  console.log(`PHASE COMMIT: ${commit}${override ? ' (override)' : ' (discovered: the commit that added this probe)'}`);

  const branch = git(['branch', '--show-current']).trim();
  raw('P11 current branch (reported, not asserted — gate-time branch name retired)', branch);
  const stat = git(['show', '--name-only', '--format=%h %s', commit]).trim();
  raw('P11 phase commit (message + files)', stat);
  const lines = stat.split('\n');
  console.log(`COMMIT: ${lines[0]}`);
  const files = lines.slice(1).filter(Boolean);
  eq(files.length, 2, 'phase commit touches exactly 2 files (globe.html + probe)');
  ok(files.every((f) => f.startsWith('ui/preview/') || f === 'scripts/phase9-j-probe.mjs'),
    'every committed file is inside ui/preview/** or scripts/phase9-j-probe.mjs');
  ok(files.includes('ui/preview/globe.html'), 'the globe page is committed');
  let ancestor = true;
  try { git(['merge-base', '--is-ancestor', commit, 'HEAD']); } catch { ancestor = false; }
  eq(ancestor, true, 'phase commit is contained in current history (gate-time: it WAS HEAD; post-merge: ancestor of HEAD)');
  done('P11');
}

const cases = { p1, p2, p3, p4, p5, p6, p7, p8, p9, p10, p11 };
const fn = cases[process.argv[2]];
if (!fn) {
  console.log('usage: node scripts/phase9-j-probe.mjs <p1|p2|p3|p4|p5|p6|p7|p8|p9|p10|p11>');
  process.exit(1);
}
await fn();

#!/usr/bin/env node
/**
 * JEXI OS — Phase 9 Scope H probe — visual QA harness (P1–P11).
 *
 * One subcommand per probe case, self-contained, raw output, exit 1 on
 * any failed assertion.
 *
 * BROWSER HONESTY: when a real headless browser exists (e.g. playwright's
 * chromium at ~/.cache/ms-playwright/chromium-*) the harness detects and
 * uses it (flavor reported everywhere); nothing is ever faked. When one is
 * absent — really absent or forced via JEXI_VISUAL_NO_BROWSER=1 (the exact
 * same code path) — the browser-requiring cases CLEAN-SKIP (ZONE-OWNER
 * ITEM 10): `SKIP: <case> — BROWSER_UNAVAILABLE`, exit 2 (exit 0 with
 * --skip-ok), matching the runner CLI's own contract. P7/P11 and P9
 * cases 3–4 run everywhere.
 *
 * Diff/determinism probes render LOCAL fixture pages (scratch/*.html)
 * to keep the logic under test free of network flakiness; the network
 * path is separately proven against https://example.com (P1/P2/P8).
 * Runtime artifacts live in scratch/ — never committed.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRATCH = join(ROOT, 'scratch');
const RUNNER_CLI = join(ROOT, 'verification', 'visual', 'puppeteer-runner.js');
const VERIFIER_JS = join(ROOT, 'server', 'src', 'services', 'director', 'Verifier.js');
const PAGE_A = join(SCRATCH, 'phase9-h-page-a.html');
const PAGE_B = join(SCRATCH, 'phase9-h-page-b.html');
const DIFF_OUT = join(SCRATCH, 'phase9-h-diff.png');
const CLI_A = join(SCRATCH, 'phase9-h-cli-a.png');
const CLI_B = join(SCRATCH, 'phase9-h-cli-b.png');

const EXAMPLE_COM = 'https://example.com';
const URL_A = `file://${PAGE_A}`;
const URL_B = `file://${PAGE_B}`;

const { createRunner, detectBrowser } = await import('../verification/visual/puppeteer-runner.js');
const { compare, decodePng } = await import('../verification/visual/screenshot-diff.js');
const { createSceneQA, SCENE_SPEC_EXAMPLE } = await import('../verification/visual/scene-qa.js');

let pass = 0;
let fail = 0;

function ok(cond, label) {
  if (cond) { pass += 1; console.log(`PASS: ${label}`); } else { fail += 1; console.log(`FAIL: ${label}`); }
}
function eq(got, want, label) {
  ok(got === want, `${label} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);
}
function raw(label, obj) {
  console.log(`--- ${label} (raw) ---`);
  console.log(typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2));
}
function done(name, skip = 0) {
  console.log(`[${name}] ${pass} PASS / ${fail} FAIL${skip ? ` / ${skip} SKIP` : ''}`);
  process.exit(fail === 0 ? 0 : 1);
}
/* ZONE-OWNER ITEM 10: clean-skip gate for browser-requiring cases — matches
 * the runner's own BROWSER_UNAVAILABLE contract ({ ok:false,
 * reason:'BROWSER_UNAVAILABLE' }; CLI exits 2, or 0 with --skip-ok). Before
 * this gate, a browserless environment crashed with TypeError
 * (decodePng(null) / compare(null,null)) or false-FAILed detection asserts. */
function browserSkipGate(name) {
  const det = detectBrowser();
  if (det.available === true) return det;
  const skipOk = process.argv.includes('--skip-ok');
  console.log(`SKIP: ${name} — BROWSER_UNAVAILABLE (${det.detail})`);
  console.log(`[${name}] SKIPPED — clean skip, same contract as puppeteer-runner CLI ` +
    `(reason BROWSER_UNAVAILABLE → exit ${skipOk ? 0 : 2}${skipOk ? ' with --skip-ok' : ''})`);
  process.exit(skipOk ? 0 : 2);
}
function pngMagic(buf) {
  return buf.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
}
function writeFixtures() {
  mkdirSync(SCRATCH, { recursive: true });
  const shell = (title, text, boxColor) => `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title><style>
  body { margin: 0; background: #101828; color: #e6ebf2; font-family: monospace;
         display: flex; align-items: center; justify-content: center; height: 100vh; }
  .card { text-align: center; }
  .box { width: 220px; height: 120px; margin: 24px auto; background: ${boxColor}; border-radius: 8px; }
  h1 { font-size: 28px; margin: 0 0 8px; }
</style></head>
<body><div class="card"><h1>JEXI VISUAL QA</h1><div class="box"></div><p>${text}</p></div></body></html>\n`;
  writeFileSync(PAGE_A, shell('jexi-qa-a', 'BASELINE STATE', '#2f81f7'), 'utf8');
  writeFileSync(PAGE_B, shell('jexi-qa-b', 'REGRESSION STATE', '#d29922'), 'utf8');
}

/* P1 — runner boots: real capture of https://example.com at 1440x900. */
async function p1() {
  const det = browserSkipGate('P1'); // item 10: clean-skip when no browser
  raw('P1 browser detection', det);
  ok(det.available === true, 'a real browser flavor is available (no faking needed)');
  ok(det.flavor === 'playwright-core' || det.flavor === 'puppeteer', `flavor is real (${det.flavor})`);

  const runner = createRunner();
  const r = await runner.capture(EXAMPLE_COM, { viewport: { width: 1440, height: 900 } });
  raw('P1 capture result', {
    ok: r.ok, url: r.url, flavor: r.flavor, bytes: r.screenshot ? r.screenshot.length : 0,
    durationMs: r.durationMs, errors: r.errors, pngMagic: r.screenshot ? pngMagic(r.screenshot) : null,
  });
  eq(r.ok, true, 'capture ok');
  ok(r.screenshot && pngMagic(r.screenshot), 'screenshot is a real PNG buffer');
  eq(r.errors.length, 0, 'no page errors on example.com');
  done('P1');
}

/* P2 — screenshot captured: buffer size, format, duration. */
async function p2() {
  browserSkipGate('P2'); // item 10: clean-skip when no browser
  const runner = createRunner();
  const t0 = Date.now();
  const r = await runner.capture(EXAMPLE_COM, { viewport: { width: 1440, height: 900 } });
  eq(r.ok, true, 'capture ok');
  const { width, height } = decodePng(r.screenshot);
  raw('P2 capture facts', {
    format: 'PNG (89504e470d0a1a0a)',
    bytes: r.screenshot.length,
    width,
    height,
    captureDurationMs: r.durationMs,
    totalWallMs: Date.now() - t0,
    flavor: r.flavor,
  });
  eq(pngMagic(r.screenshot), true, 'format is PNG (magic verified)');
  eq(width, 1440, 'decoded width is 1440');
  eq(height, 900, 'decoded height is 900');
  ok(r.durationMs > 0 && r.durationMs < 60000, 'durationMs is sane');
  done('P2');
}

/* P3 — two real captures of the same page → identical. */
async function p3() {
  browserSkipGate('P3'); // item 10: clean-skip when no browser
  writeFixtures();
  const runner = createRunner();
  const a = await runner.capture(URL_A);
  const b = await runner.capture(URL_A);
  eq(a.ok, true, 'capture A ok');
  eq(b.ok, true, 'capture B ok');
  const d = compare(a.screenshot, b.screenshot);
  raw('P3 compare(two captures of the same page)', {
    changed: d.changed, pixelsDiff: d.pixelsDiff, totalPixels: d.totalPixels, pctDiff: d.pctDiff,
    width: d.width, height: d.height,
  });
  eq(d.changed, false, 'changed is false');
  eq(d.pctDiff, 0, 'pctDiff is 0');
  eq(d.pixelsDiff, 0, 'pixelsDiff is 0');
  done('P3');
}

/* P4 — two different pages → real regression detected. */
async function p4() {
  browserSkipGate('P4'); // item 10: clean-skip when no browser
  writeFixtures();
  const runner = createRunner();
  const a = await runner.capture(URL_A);
  const b = await runner.capture(URL_B);
  eq(a.ok, true, 'capture A (baseline) ok');
  eq(b.ok, true, 'capture B (regressed) ok');
  const d = compare(a.screenshot, b.screenshot);
  writeFileSync(DIFF_OUT, d.diffImage);
  raw('P4 compare(baseline vs regressed)', {
    changed: d.changed, pixelsDiff: d.pixelsDiff, totalPixels: d.totalPixels,
    pctDiff: Number(d.pctDiff.toFixed(4)), diffImageBytes: d.diffImage.length,
    diffImagePng: pngMagic(d.diffImage), writtenTo: 'scratch/phase9-h-diff.png',
  });
  eq(d.changed, true, 'changed is true');
  ok(d.pctDiff > 0, 'pctDiff > 0');
  ok(d.pixelsDiff > 0, 'pixelsDiff > 0');
  ok(pngMagic(d.diffImage), 'diff image is a real PNG');
  done('P4');
}

/* P5 — threshold accepts a small real diff. */
async function p5() {
  browserSkipGate('P5'); // item 10: clean-skip when no browser
  writeFixtures();
  const runner = createRunner();
  const a = await runner.capture(URL_A);
  const b = await runner.capture(URL_B);
  eq(a.ok && b.ok, true, 'both captures ok');
  const strict = compare(a.screenshot, b.screenshot); // threshold 0
  ok(strict.pixelsDiff > 0 && strict.changed === true, 'strict compare flags the real diff');
  const threshold = strict.pctDiff + 5; // accept anything below measured diff + 5%
  const lenient = compare(a.screenshot, b.screenshot, { threshold });
  raw('P5 threshold semantics', {
    pixelsDiff: lenient.pixelsDiff,
    pctDiff: Number(lenient.pctDiff.toFixed(4)),
    threshold,
    changed: lenient.changed,
  });
  ok(lenient.pixelsDiff > 0, 'the diff is nonzero (pixelsDiff > 0)');
  eq(lenient.changed, false, 'changed is false under the raised threshold — small diff accepted');
  done('P5');
}

/* P6 — diff image produced on disk. */
async function p6() {
  browserSkipGate('P6'); // item 10: clean-skip when no browser
  writeFixtures();
  const runner = createRunner();
  const a = await runner.capture(URL_A);
  const b = await runner.capture(URL_B);
  eq(a.ok && b.ok, true, 'both captures ok');
  const d = compare(a.screenshot, b.screenshot);
  writeFileSync(DIFF_OUT, d.diffImage);
  const st = statSync(DIFF_OUT);
  const fromDisk = readFileSync(DIFF_OUT);
  // Prove the red-highlight pixels are really in the diff image.
  const decoded = decodePng(d.diffImage);
  let red = 0;
  for (let i = 0; i < decoded.rgba.length; i += 4) {
    if (decoded.rgba[i] === 255 && decoded.rgba[i + 1] === 0 && decoded.rgba[i + 2] === 0) red += 1;
  }
  raw('P6 diff image on disk', {
    path: 'scratch/phase9-h-diff.png',
    bytesOnDisk: st.size,
    pngMagicFromDisk: pngMagic(fromDisk),
    dimensions: `${decoded.width}x${decoded.height}`,
    redHighlightPixels: red,
    pixelsDiff: d.pixelsDiff,
  });
  ok(st.size > 0, 'diff image written to disk, non-empty');
  eq(pngMagic(fromDisk), true, 'file on disk is a real PNG');
  eq(red, d.pixelsDiff, 'every differing pixel is red-highlighted in the diff image');
  done('P6');
}

/* P7 — clean skip when browser missing (forced, same path as real absence). */
async function p7() {
  process.env.JEXI_VISUAL_NO_BROWSER = '1';
  const det = detectBrowser();
  const runner = createRunner();
  let r = null;
  let threw = false;
  try {
    r = await runner.capture(EXAMPLE_COM);
  } catch (e) {
    threw = true;
    raw('P7 unexpected throw', { name: e.name, message: e.message });
  }
  raw('P7 runner.skip', r);
  const qa = createSceneQA();
  let s = null;
  try {
    s = await qa.check(EXAMPLE_COM, SCENE_SPEC_EXAMPLE);
  } catch (e) {
    threw = true;
    raw('P7 unexpected throw (scene)', { name: e.name, message: e.message });
  }
  raw('P7 scene.skip', s);
  delete process.env.JEXI_VISUAL_NO_BROWSER;

  eq(threw, false, 'no crash — skip is a clean return');
  eq(det.available, false, 'detection reports unavailable');
  ok(String(det.detail).includes('JEXI_VISUAL_NO_BROWSER'), 'detail names the forcing env (same path as real absence)');
  eq(r?.ok, false, 'capture ok:false');
  eq(r?.reason, 'BROWSER_UNAVAILABLE', 'reason is BROWSER_UNAVAILABLE');
  eq(r?.screenshot, null, 'screenshot is null — NOT a fake buffer');
  eq(s?.ok, false, 'scene.check ok:false');
  eq(s?.reason, 'BROWSER_UNAVAILABLE', 'scene reason is BROWSER_UNAVAILABLE');
  eq(s?.observations.length, 0, 'no fabricated observations');
  done('P7');
}

/* P8 — scene check on a known static page (real browser). */
async function p8() {
  browserSkipGate('P8'); // item 10: clean-skip when no browser
  raw('P8 scene spec schema (SCENE_SPEC_EXAMPLE)', SCENE_SPEC_EXAMPLE);
  const qa = createSceneQA();
  const result = await qa.check(EXAMPLE_COM, {
    titleContains: 'Example',
    elements: [
      { what: 'main heading', selector: 'h1', expect: 'present' },
      { what: 'paragraph text', selector: 'p', expect: 'visible' },
      { what: 'anchor link', selector: 'a', expect: 'visible' },
    ],
  });
  raw('P8 scene.check result', result);
  eq(result.ok, true, 'scene check ok');
  ok(result.observations.length >= 3, `observations emitted (${result.observations.length})`);
  ok(result.observations.every((o) => o.pass), 'every observation passes');
  eq(result.errors.length, 0, 'no page errors');
  done('P8');
}

/* P9 — CI-safe exit codes via the CLI. */
async function p9() {
  // ZONE-OWNER ITEM 10: cases 1–2 need a real browser; cases 3–4 prove the
  // CLI skip exit codes, which work precisely when no browser exists — run
  // those everywhere and clean-skip 1–2 (reported as SKIP, not FAIL/crash).
  const det = detectBrowser();
  const hasBrowser = det.available === true;
  let skip = 0;
  writeFixtures();
  const node = process.execPath;
  const run = (args, env) => spawnSync(node, [RUNNER_CLI, ...args], {
    encoding: 'utf8', timeout: 120000, env: { ...process.env, ...(env || {}) },
  });

  let r;
  if (hasBrowser) {
    r = run(['capture', URL_A, '--out', CLI_A]);
    raw('P9 case 1 — capture success (exit 0)', { stdout: r.stdout.trim(), stderr: r.stderr.trim(), exitCode: r.status });
    eq(r.status, 0, 'success → exit 0');
    ok(existsSync(CLI_A), 'screenshot written by CLI');

    r = run(['capture', URL_B, '--out', CLI_B]);
    eq(r.status, 0, 'second capture ok (for the regression case)');

    r = run(['compare', CLI_A, CLI_B, '--diff-out', DIFF_OUT]);
    raw('P9 case 2 — compare regression (exit 1)', { stdout: r.stdout.trim(), exitCode: r.status });
    eq(r.status, 1, 'real regression → exit 1');
  } else {
    console.log(`SKIP: P9 case 1 — capture success (BROWSER_UNAVAILABLE: ${det.detail})`);
    console.log('SKIP: P9 case 2 — compare regression (BROWSER_UNAVAILABLE)');
    skip = 2;
  }

  r = run(['capture', EXAMPLE_COM, '--skip-ok'], { JEXI_VISUAL_NO_BROWSER: '1' });
  raw('P9 case 3 — skip with --skip-ok (exit 0)', { stdout: r.stdout.trim(), exitCode: r.status });
  eq(r.status, 0, 'skip with --skip-ok → exit 0');

  r = run(['capture', EXAMPLE_COM], { JEXI_VISUAL_NO_BROWSER: '1' });
  raw('P9 case 4 — skip without --skip-ok (exit 2)', { stdout: r.stdout.trim(), exitCode: r.status });
  eq(r.status, 2, 'skip without --skip-ok → exit 2');
  done('P9', skip);
}

/* P10 — determinism: same page twice. */
async function p10() {
  browserSkipGate('P10'); // item 10: clean-skip when no browser
  writeFixtures();
  const runner = createRunner();
  const a = await runner.capture(URL_A);
  const b = await runner.capture(URL_A);
  eq(a.ok && b.ok, true, 'both captures ok');
  const bytesEqual = a.screenshot.equals(b.screenshot);
  raw('P10 determinism', {
    bytesA: a.screenshot.length,
    bytesB: b.screenshot.length,
    byteIdentical: bytesEqual,
  });
  if (bytesEqual) {
    console.log('VERDICT: byte-identical PNGs — rendering is deterministic for this static page.');
    ok(true, 'byte-identical');
  } else {
    const d = compare(a.screenshot, b.screenshot);
    raw('P10 pixel-level compare (bytes differed)', {
      pixelsDiff: d.pixelsDiff, pctDiff: d.pctDiff,
    });
    if (d.pixelsDiff === 0) {
      console.log('VERDICT: byte-level non-determinism from PNG encoder metadata (zlib stream), pixel-identical — documented.');
      ok(true, 'pixel-identical (documented non-determinism)');
    } else {
      ok(false, 'renders are not deterministic (pixels differ) — honest failure');
    }
  }
  done('P10');
}

/* P11 — integration point: where server/src would call visual QA. */
async function p11() {
  const content = readFileSync(VERIFIER_JS, 'utf8');
  const lines = content.split('\n');
  const idx = lines.findIndex((l) => l.includes('BROWSER_CLAIM_RE'));
  ok(idx !== -1, `integration line found (server/src/services/director/Verifier.js:${idx + 1})`);
  ok(idx !== -1 && /browser|puppeteer|playwright|selenium/i.test(lines[idx]),
    'the line is the browser-claim detector');
  raw('P11 cited integration line (verbatim from disk)', {
    file: 'server/src/services/director/Verifier.js',
    line: idx + 1,
    content: lines[idx].trim().slice(0, 300),
  });
  console.log(`--- P11 integration narrative (raw) ---`);
  console.log(`server/src/services/director/Verifier.js:${idx + 1} — BROWSER_CLAIM_RE (B213 method provenance): ` +
    `the Director's verifier flags deliverables that CLAIM real-browser work "headless browser", "puppeteer", ` +
    `"screenshot..." without evidence.`);
  console.log(`Plausible wiring: when the verifier trips that regex, it invokes THIS harness ` +
    `(verification/visual/puppeteer-runner.js createRunner().capture + screenshot-diff compare) to turn the claim ` +
    `into verified pixels, and scene-qa.check for 3D deliverables (Scope J globe).`);
  console.log(`Wiring requires server/src/** edits → ZONE-OWNER TASK (Scope H zone is verification/visual/** only).`);
  done('P11');
}

const cases = { p1, p2, p3, p4, p5, p6, p7, p8, p9, p10, p11 };
const fn = cases[process.argv[2]];
if (!fn) {
  console.log('usage: node scripts/phase9-h-probe.mjs <p1|p2|p3|p4|p5|p6|p7|p8|p9|p10|p11>');
  process.exit(1);
}
await fn();

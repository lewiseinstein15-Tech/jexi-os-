/**
 * M8 — PHONE SETUP WIZARD regression suite (keyless: the backend is open).
 *
 * Proves: the SetupWizard component renders its first step statically
 * (title, brain-address input, test button, skip link — no fetch on
 * mount); the probe module shapes every outcome honestly against a stub
 * brain (health ok/down/empty); the server exposes NO /api/key/verify
 * route and no key gate; and App gates first-run on setup completion.
 *
 * NOTE: renders via react-dom/server (no browser needed).
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { execFileSync } from 'child_process';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const esbuild = path.join(ROOT, 'node_modules', 'esbuild', 'bin', 'esbuild');
const tmpOut = path.join(ROOT, 'server', 'test-support', '.m8-test.cjs');
fs.mkdirSync(path.dirname(tmpOut), { recursive: true });

let failures = 0;
const ok = (name, cond) => { console.log(`${cond ? '✅' : '❌'} ${name}`); if (!cond) failures += 1; };

/* ─────────────── static source checks ─────────────── */
const wiz = fs.readFileSync(path.join(ROOT, 'src', 'components', 'SetupWizard.jsx'), 'utf-8');
ok('wizard: two steps (brain → done)', /step === 1/.test(wiz) && /step === 2/.test(wiz) && !/step === 3/.test(wiz));
ok('wizard: transition earned by a live probe (probeHealth)', /probeHealth\(url\)/.test(wiz));
ok('wizard: no key step anywhere', !/verifyAccessKey|access [Kk]ey|JEXI_API_KEY|x-jexi-key/.test(wiz));
ok('wizard: no fetch on mount (static-markup safe)', !/useEffect/.test(wiz));
ok('wizard: skip escape for later setup', /Skip setup for now/.test(wiz) && /onSkip/.test(wiz));
ok('wizard: completion hands the proven address up (onDone)', /onDone\(normalizeBase\(url\)\)/.test(wiz));

const app = fs.readFileSync(path.join(ROOT, 'src', 'App.jsx'), 'utf-8');
ok('app: first-run gates on setup completion', /jexi_setup_done/.test(app) && /<SetupWizard/.test(app));
ok('app: wizard completion persists url only', /setBackendUrl\(url\)/.test(app) && !/setAccessKey/.test(app));

const indexJs = fs.readFileSync(path.join(ROOT, 'server', 'index.js'), 'utf-8');
ok('server: no /api/key/verify route (lock removed)', !/api\/key\/verify/.test(indexJs));
ok('server: no key gate (no OPEN_PATHS, no 401 lock)', !/OPEN_PATHS/.test(indexJs) && !/x-jexi-key/.test(indexJs) && !/JEXI_API_KEY/.test(indexJs));

/* ─────────────── render the real component ─────────────── */
let mod = null;
try {
  execFileSync(esbuild, [
    path.join(ROOT, 'src', 'components', 'SetupWizard.jsx'),
    '--bundle', '--platform=node', '--format=cjs', '--loader:.jsx=jsx',
    '--external:react', '--outfile=' + tmpOut, '--log-level=error',
  ], { stdio: 'pipe' });
  mod = await import(pathToFileURL(tmpOut).href);
} finally {
  try { fs.unlinkSync(tmpOut); } catch { /* best effort */ }
}
const exp = mod && mod.default && typeof mod.default === 'object' && mod.default.default ? mod.default : mod;
const SetupWizard = exp.default || exp;
const html = renderToStaticMarkup(React.createElement(SetupWizard, { initialUrl: 'https://brain.example.com', onDone: () => {}, onSkip: () => {} }));
ok('render: step-1 title', html.includes('Point at your brain'));
ok('render: brain-address input with the initial URL', /<input[^>]*brain\.example\.com/.test(html));
ok('render: test-connection button', html.includes('Test connection'));
ok('render: skip link', html.includes('Skip setup for now'));
ok('render: step indicator', html.includes('Step 1 of 2'));

/* ─────────────── probes vs a stub brain ─────────────── */
const stub = http.createServer((req, res) => {
  if (req.url === '/api/health') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); return; }
  res.writeHead(404); res.end('nope');
});
await new Promise((r) => stub.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${stub.address().port}`;
const probeMod = await import(pathToFileURL(path.join(ROOT, 'src', 'utils', 'setupProbe.js')).href);
const { probeHealth, normalizeBase } = probeMod;
ok('probe: no verifyAccessKey export (lock removed)', !('verifyAccessKey' in probeMod));

ok('probe: normalize adds https + trims slashes', normalizeBase('brain.example.com/') === 'https://brain.example.com');
{
  const h = await probeHealth(base);
  ok('probe: healthy brain ok with timing', h.ok === true && typeof h.ms === 'number');
}
{
  const h = await probeHealth('http://127.0.0.1:1', { timeoutMs: 1500 });
  ok('probe: dead address fails honestly', h.ok === false && /Unreachable|No answer/.test(h.error));
}
{
  const h = await probeHealth('');
  ok('probe: empty base rejected before fetch', h.ok === false && /address/.test(h.error));
}
stub.close();

console.log(failures === 0 ? '\n🎉 ALL SETUP-WIZARD CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);

/**
 * M8 — PHONE SETUP WIZARD regression suite.
 *
 * Proves: the SetupWizard component renders its first step statically
 * (title, brain-address input, test button, keyless escape — no fetch on
 * mount); the probe module shapes every outcome honestly against a stub
 * brain (health ok/down, key accepted/rejected/empty); the server exposes
 * GET /api/key/verify as a GATED route (present as a route, absent from
 * OPEN_PATHS); and App gates first-run on the wizard.
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
ok('wizard: three steps (brain → key → done)', /step === 1/.test(wiz) && /step === 2/.test(wiz) && /step === 3/.test(wiz));
ok('wizard: transitions earned by live probes (probeHealth + verifyAccessKey)', /probeHealth\(url\)/.test(wiz) && /verifyAccessKey\(url, key\)/.test(wiz));
ok('wizard: no fetch on mount (static-markup safe)', !/useEffect/.test(wiz));
ok('wizard: keyless escape for local brains', /Continue without a key/.test(wiz) && /onSkip/.test(wiz));
ok('wizard: completion hands the proven pair up (onDone)', /onDone\(normalizeBase\(url\), key\.trim\(\)\)/.test(wiz));

const app = fs.readFileSync(path.join(ROOT, 'src', 'App.jsx'), 'utf-8');
ok('app: first-run gates on the wizard (no key + never set up)', /jexi_setup_done/.test(app) && /<SetupWizard/.test(app));
ok('app: wizard completion persists url + key', /setBackendUrl\(url\)/.test(app) && /setAccessKey\(key\)/.test(app));

const indexJs = fs.readFileSync(path.join(ROOT, 'server', 'index.js'), 'utf-8');
ok('server: GET /api/key/verify route exists', /app\.get\('\/api\/key\/verify'/.test(indexJs));
{
  const openPaths = (indexJs.match(/const OPEN_PATHS = \[[^\]]*\]/) || [''])[0];
  ok('server: /api/key/verify is GATED (absent from OPEN_PATHS)', !openPaths.includes('/api/key/verify'));
}

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
ok('render: keyless escape link', html.includes('Continue without a key'));
ok('render: step indicator', html.includes('Step 1 of 3'));

/* ─────────────── probes vs a stub brain ─────────────── */
const stub = http.createServer((req, res) => {
  if (req.url === '/api/health') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); return; }
  if (req.url === '/api/key/verify') {
    if (req.headers['x-jexi-key'] === 'right-key') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); }
    else { res.writeHead(401, { 'content-type': 'application/json' }); res.end('{"error":"nope"}'); }
    return;
  }
  res.writeHead(404); res.end('nope');
});
await new Promise((r) => stub.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${stub.address().port}`;
const { probeHealth, verifyAccessKey, normalizeBase } = await import(pathToFileURL(path.join(ROOT, 'src', 'utils', 'setupProbe.js')).href);

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
{
  const v = await verifyAccessKey(base, 'right-key');
  ok('probe: right key accepted', v.ok === true);
}
{
  const v = await verifyAccessKey(base, 'wrong-key');
  ok('probe: wrong key rejected as 401', v.ok === false && v.status === 401 && /Wrong key/.test(v.error));
}
{
  const v = await verifyAccessKey(base, '  ');
  ok('probe: empty key rejected before fetch', v.ok === false && /key/.test(v.error));
}
{
  const v = await verifyAccessKey('', 'right-key');
  ok('probe: empty base rejected before fetch', v.ok === false && /address/.test(v.error));
}
stub.close();

console.log(failures === 0 ? '\n🎉 ALL SETUP-WIZARD CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);

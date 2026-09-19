#!/usr/bin/env node
/**
 * ZONE-OWNER ITEM 6 LIVE PROBE — ephemeral token HTTP route.
 * Run from repo root:  node scripts/zone-owner-item6-probe.mjs
 * Boots a REAL express server (server/node_modules) mounting
 * server/src/routes/tokens.js on 127.0.0.1, then drives it with REAL curl:
 *   1. POST /api/tokens/mint   → real token (NEVER printed — masked + sha256 fingerprint)
 *   2. GET  /api/tokens/verify → ok:true with scope/subject/expiresAt
 *   3. tamper the signature    → ok:false, reason TAMPERED
 *   4. wait past TTL           → ok:false, reason EXPIRED
 *   5. engine ceilings through the route: unknown scope + TTL above 1h → 400
 */
import crypto from 'node:crypto';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0; let checks = 0;
const check = (label, cond, detail = '') => {
  checks++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!cond) fails++;
};
// NEVER print the token: masked form + fingerprint only.
const mask = (t) => typeof t === 'string' && t.startsWith('jexi_eph.v1.')
  ? `jexi_eph.v1.…(len=${t.length}, sha256:${crypto.createHash('sha256').update(t).digest('hex').slice(0, 12)})`
  : JSON.stringify(t);
const redact = (obj) => JSON.stringify(obj, (k, v) => (k === 'token' ? mask(v) : v));

// ---- boot the real route on a real socket
const serverCode = `
  const { createRequire } = await import('node:module');
  const require = createRequire(${JSON.stringify(path.join(ROOT, 'server/package.json'))});
  const express = require('express');
  const { mountTokens } = await import(${JSON.stringify(path.join(ROOT, 'server/src/routes/tokens.js'))});
  const app = express();
  app.use(express.json());
  mountTokens(app);
  const srv = app.listen(0, '127.0.0.1', () => console.log('PROBE-PORT ' + srv.address().port));
`;
const child = spawn(process.execPath, ['--input-type=module', '-e', serverCode], {
  cwd: ROOT, env: { ...process.env, NODE_NO_WARNINGS: '1' }, stdio: ['ignore', 'pipe', 'inherit'],
});
let port = null;
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('server boot timeout')), 15000);
  child.stdout.on('data', (d) => {
    const m = String(d).match(/PROBE-PORT (\d+)/);
    if (m) { port = Number(m[1]); clearTimeout(t); resolve(); }
  });
  child.on('exit', (c) => { clearTimeout(t); reject(new Error(`server exited early (${c})`)); });
});
const BASE = `http://127.0.0.1:${port}`;
console.log(`route server listening on ${BASE} (pid ${child.pid})`);
const curl = (...args) => execFileSync('curl', ['-s', ...args], { encoding: 'utf8' });

try {
  // ---- 1. mint a real token
  const mintRaw = curl('-X', 'POST', `${BASE}/api/tokens/mint`, '-H', 'content-type: application/json',
    '-d', JSON.stringify({ scope: ['read'], ttlMs: 600_000, subject: 'probe-session-1' }));
  const mint = JSON.parse(mintRaw);
  console.log(`curl POST /api/tokens/mint → ${redact(mint)}`);
  check('POST /api/tokens/mint → real token (jexi_eph.v1.…), expiresAt/scope/subject correct',
    mint.ok === true && typeof mint.token === 'string' && mint.token.startsWith('jexi_eph.v1.') &&
    mint.scope?.[0] === 'read' && mint.subject === 'probe-session-1' &&
    Math.abs(mint.expiresAt - (Date.now() + 600_000)) < 10_000,
    `token=${mask(mint.token)} expiresAt=${mint.expiresAt}`);

  // ---- 2. verify it
  const verRaw = curl(`${BASE}/api/tokens/verify?token=${encodeURIComponent(mint.token)}`);
  const ver = JSON.parse(verRaw);
  console.log(`curl GET /api/tokens/verify → ${redact(ver)}`);
  check('GET /api/tokens/verify → ok:true with scope/subject/expiresAt',
    ver.ok === true && ver.scope?.[0] === 'read' && ver.subject === 'probe-session-1' && ver.expiresAt === mint.expiresAt);

  // ---- 3. tamper the SIGNATURE segment → TAMPERED (distinct from MALFORMED)
  const segs = mint.token.split('.');
  const sig = segs[3];
  const flipped = (sig[10] === 'A' ? 'B' : 'A');
  const tampered = [segs[0], segs[1], segs[2], sig.slice(0, 10) + flipped + sig.slice(11)].join('.');
  const tam = JSON.parse(curl(`${BASE}/api/tokens/verify?token=${encodeURIComponent(tampered)}`));
  console.log(`curl GET /api/tokens/verify (tampered sig ${mask(tampered)}) → ${redact(tam)}`);
  check('tampered signature → ok:false, reason TAMPERED', tam.ok === false && tam.reason === 'TAMPERED', `reason=${tam.reason}`);

  // ---- 4. TTL expiry: mint a 1.2s token, wait it out → EXPIRED
  const short = JSON.parse(curl('-X', 'POST', `${BASE}/api/tokens/mint`, '-H', 'content-type: application/json',
    '-d', JSON.stringify({ scope: ['read'], ttlMs: 1200, subject: 'probe-shortlived' })));
  console.log(`minted ttlMs=1200 token=${mask(short.token)} — waiting 1.8s…`);
  await new Promise((r) => setTimeout(r, 1800));
  const exp = JSON.parse(curl(`${BASE}/api/tokens/verify?token=${encodeURIComponent(short.token)}`));
  console.log(`curl GET /api/tokens/verify (past TTL) → ${redact(exp)}`);
  check('wait past TTL → ok:false, reason EXPIRED', exp.ok === false && exp.reason === 'EXPIRED', `reason=${exp.reason}`);

  // ---- 5. engine ceilings enforced through the route
  const badScope = curl('-o', '/dev/null', '-w', '%{http_code}', '-X', 'POST', `${BASE}/api/tokens/mint`,
    '-H', 'content-type: application/json', '-d', JSON.stringify({ scope: ['launch-missiles'] }));
  const badScopeBody = JSON.parse(curl('-X', 'POST', `${BASE}/api/tokens/mint`, '-H', 'content-type: application/json',
    '-d', JSON.stringify({ scope: ['launch-missiles'] })));
  const badTtl = JSON.parse(curl('-X', 'POST', `${BASE}/api/tokens/mint`, '-H', 'content-type: application/json',
    '-d', JSON.stringify({ scope: ['read'], ttlMs: 7_200_000 })));
  console.log(`unknown-scope mint → HTTP ${badScope} ${redact(badScopeBody)}`);
  console.log(`ttl 2h mint → ${redact(badTtl)}`);
  check('scope allow-list (default deny) → 400 E_UNKNOWN_SCOPE', badScope === '400' && badScopeBody.code === 'E_UNKNOWN_SCOPE');
  check('TTL ceiling (1h hard) → 400 E_TTL_ABOVE_CEILING', badTtl.ok === false && badTtl.code === 'E_TTL_ABOVE_CEILING');

  const pol = JSON.parse(curl(`${BASE}/api/tokens/policy`));
  check('GET /api/tokens/policy exposes the ceilings (no secrets)', pol.ok === true && pol.maxTtlMs === 3_600_000 && Array.isArray(pol.scopes),
    redact(pol));
} finally {
  child.kill('SIGTERM');
}

console.log(`\n===== PROBE TALLY: ${checks} checked, ${checks - fails} pass, ${fails} fail =====`);
process.exit(fails === 0 ? 0 : 1);

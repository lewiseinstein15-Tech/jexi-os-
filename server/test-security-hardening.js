/**
 * JEXI OS — security hardening regression suite.
 *
 * Guards the Phase-1 security fixes:
 *   - SSRF guard: cloud-metadata link-local range, IPv6, IPv4-mapped IPv6,
 *     multi-address DNS, redirect chains, fail-closed parse errors.
 *   - Path safety: workspace-escape rejection for reads AND writes,
 *     shell-safe single file names.
 *   - Runner: file runs go through execFile (no shell interpolation).
 */

import { isSSRF, assertSafeUrl, safeFetchUrl } from './src/services/Security.js';
import { resolveInside, isInside, isShellSafeFileName } from './src/services/PathSafety.js';
import { runFile, runCommand } from './src/services/Runner.js';
import { WORKSPACE_DIR } from './src/config.js';
import fs from 'fs';
import os from 'os';
import path from 'path';

let passed = 0;
let failed = 0;
const ok = (cond, name) => {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}`); }
};

/* ------------------------------------------------------------------ */
/* 1. SSRF guard                                                       */
/* ------------------------------------------------------------------ */
console.log('\n== SSRF guard ==');

ok(await isSSRF('http://localhost:3002'), 'localhost blocked');
ok(await isSSRF('http://127.0.0.1'), '127.0.0.1 blocked');
ok(await isSSRF('http://0.0.0.0'), '0.0.0.0 blocked');
ok(await isSSRF('http://169.254.169.254/latest/meta-data'), 'cloud metadata link-local blocked (AWS/GCE/Azure)');
ok(await isSSRF('http://169.254.170.2/credentials'), 'link-local range blocked');
ok(await isSSRF('http://10.0.0.5'), '10/8 blocked');
ok(await isSSRF('http://172.16.0.1'), '172.16/12 blocked');
ok(await isSSRF('http://172.31.255.255'), '172.16/12 upper edge blocked');
ok(await isSSRF('http://192.168.1.1'), '192.168/16 blocked');
ok(await isSSRF('http://100.64.0.1'), 'CGNAT 100.64/10 blocked');
ok(await isSSRF('http://[::1]:3002'), 'IPv6 loopback blocked');
ok(await isSSRF('http://[fc00::1]'), 'IPv6 ULA blocked');
ok(await isSSRF('http://[fe80::1]'), 'IPv6 link-local blocked');
ok(await isSSRF('http://[::ffff:127.0.0.1]'), 'IPv4-mapped IPv6 loopback blocked');
ok(await isSSRF('http://[::ffff:169.254.169.254]'), 'IPv4-mapped metadata blocked');
ok(await isSSRF('http://metadata.google.internal'), 'metadata hostname blocked');
ok(await isSSRF('http://foo.localhost/x'), '*.localhost blocked');
ok(await isSSRF('http://foo.internal/x'), '*.internal blocked');
ok(await isSSRF('file:///etc/passwd'), 'file:// blocked');
ok(await isSSRF('ftp://example.com/x'), 'ftp:// blocked');
ok(await isSSRF('not a url'), 'garbage input blocked (fail closed)');
ok(!(await isSSRF('https://example.com')), 'public https allowed');
ok(!(await isSSRF('https://github.com')), 'public github allowed');

await assertSafeUrl('https://example.com');
let threw = false;
try { await assertSafeUrl('http://169.254.169.254/latest/meta-data'); } catch { threw = true; }
ok(threw, 'assertSafeUrl throws on metadata URL');

// safeFetchUrl: a redirect to an internal target must be refused (mock impl).
const fakeRedirectToInternal = async () => ({ status: 302, headers: { get: () => 'http://127.0.0.1:9/secret' } });
threw = false;
try { await safeFetchUrl('https://example.com', {}, fakeRedirectToInternal); } catch { threw = true; }
ok(threw, 'safeFetchUrl refuses redirect to internal target');

const fakeRedirectToPublic = async (url, opts) => {
  if (opts.redirect === 'manual' && url === 'https://example.com') {
    return { status: 302, headers: { get: () => 'https://example.org/page' } };
  }
  return { status: 200, headers: { get: () => null }, ok: true };
};
const res = await safeFetchUrl('https://example.com', {}, fakeRedirectToPublic);
ok(res.status === 200, 'safeFetchUrl follows redirect to public target');

/* ------------------------------------------------------------------ */
/* 2. Path safety                                                      */
/* ------------------------------------------------------------------ */
console.log('\n== Path safety ==');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-sec-'));

ok(resolveInside(tmpRoot, 'app.js') === path.join(tmpRoot, 'app.js'), 'plain name resolves inside root');
ok(resolveInside(tmpRoot, 'sub/dir/file.txt').startsWith(tmpRoot), 'nested relative name resolves inside root');
ok(resolveInside(tmpRoot, 'name with spaces.py') === path.join(tmpRoot, 'name with spaces.py'), 'spaces fine (argv, not shell)');

const escapes = ['../../etc/passwd', '/etc/passwd', 'a/../../b', '..', '../..', 'x\0y', 'C:\\windows\\x'];
for (const evil of escapes) {
  ok(!isInside(tmpRoot, evil), `escape blocked: ${JSON.stringify(evil)}`);
}
// URL-encoded traversal is decoded by Express BEFORE it reaches these helpers;
// simulate that layer here (double-encoded %252F stays literal and harmless).
ok(!isInside(tmpRoot, decodeURIComponent('..%2F..%2Fetc%2Fpasswd')), 'encoded traversal blocked after route decode');
ok(isInside(tmpRoot, '..%252F..%252Fetc%252Fpasswd'), 'double-encoded traversal harmless (literal name)');
threw = false;
try { resolveInside(tmpRoot, '../../etc/passwd'); } catch { threw = true; }
ok(threw, 'resolveInside throws on traversal');

ok(isShellSafeFileName('index.html'), 'index.html shell-safe');
ok(isShellSafeFileName('my app.py'), 'spaced name shell-safe (argv)');
ok(isShellSafeFileName('data-report-1720000000000.html'), 'generated report name shell-safe');
ok(!isShellSafeFileName('x; rm -rf /'), 'semicolon injection rejected');
ok(!isShellSafeFileName('$(id)'), 'command substitution rejected');
ok(!isShellSafeFileName('../etc/passwd'), 'traversal rejected');
ok(!isShellSafeFileName('-rf'), 'leading dash rejected');
ok(!isShellSafeFileName('a/b.py'), 'path separator rejected');
ok(!isShellSafeFileName(''), 'empty rejected');

/* ------------------------------------------------------------------ */
/* 3. Runner — file runs never shell-interpolate filenames              */
/*    (files must live in WORKSPACE_DIR, which runFile resolves to)     */
/* ------------------------------------------------------------------ */
console.log('\n== Runner ==');
const WS = WORKSPACE_DIR;
fs.mkdirSync(WS, { recursive: true });

// A hostile filename must be refused outright (no shell ever sees it).
fs.writeFileSync(path.join(WS, 'evil; echo PWNED > pwned.txt.py'), 'print("hi")\n');
const resEvil = await runFile('evil; echo PWNED > pwned.txt.py');
ok(resEvil.success === false && /safe file name/.test(resEvil.output), 'hostile filename refused before execution');
ok(!fs.existsSync(path.join(WS, 'pwned.txt')), 'injected command did not run');

// A real script still runs.
fs.writeFileSync(path.join(WS, 'hello-runner.py'), 'print("hello-from-runner")\n');
const resPy = await runFile('hello-runner.py', (stream, data) => {});
ok(resPy.success === true && /hello-from-runner/.test(resPy.output), 'valid .py still runs via execFile');

// runCommand (explicit shell tool) still works for the code-run tool.
const resCmd = await runCommand('echo shell-ok', { cwd: tmpRoot, timeout: 5000 });
ok(resCmd.success === true && /shell-ok/.test(resCmd.output), 'runCommand shell tool unaffected');

// Cleanup
for (const f of ['evil; echo PWNED > pwned.txt.py', 'hello-runner.py', 'pwned.txt']) {
  try { fs.unlinkSync(path.join(WS, f)); } catch {}
}

console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

/**
 * JEXI OS — PHASE 31 SCOPE 8 — live probe (P8 + P9; P1–P7 are command probes).
 *
 * P8 regression: 37 W31 boot lines intact (15 S1 + 7 S3 + 8 S5 + 7 P30),
 *                0 FAIL-SOFT, /api/health 200. Scope 8 is hygiene-only:
 *                no new wiring, so the W31 count must be UNCHANGED.
 * P9 zone check: git status --short shows only this scope's named call sites
 *                + scripts/phase31-*.mjs (run PRE-commit).
 */
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'w31s8-probe-'));
const FAILS = [];
let n = 0;
function check(id, ok, detail) {
  n += 1;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${id} — ${detail}`);
  if (!ok) FAILS.push(`${id}: ${detail}`);
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function health(port, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return { status: res.status, body: await res.text() };
    } catch { /* not up yet */ }
    await pause(700);
  }
  return null;
}
function bootServer(port, runtimeDir, dataDir) {
  const logFile = path.join(TMP, `boot-${port}.log`);
  const child = spawn(process.execPath, ['index.js'], {
    cwd: path.join(ROOT, 'server'),
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', JEXI_W31_RUNTIME: runtimeDir, DATA_DIR: dataDir },
    stdio: ['ignore', fs.openSync(logFile, 'a'), fs.openSync(logFile, 'a')],
  });
  return { child, logFile };
}
const w31Lines = (file) => fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.startsWith('W31 '));
const j = (v) => JSON.stringify(v);
const isS6 = (l) => /W31 P30\./.test(l);
const isS5 = (l) => /W31 (W13|W14|W29|S4-N8N|S4-EXEC|S4-REPOCTX|W23c|W16)/.test(l);
const isS3 = (l) => /W31 (S3-|W23e|W23f|WA4:)/.test(l);

/* ================= P8 — regression: 37 W31 boot lines intact =============== */
console.log('== P8 regression: 37 W31 boot lines intact, /api/health 200 ==');
const PORT1 = 5300 + (process.pid % 300) * 2;
const rt1 = path.join(TMP, 'boot1-runtime');
const dt1 = path.join(TMP, 'boot1-data');
const b1 = bootServer(PORT1, rt1, dt1);
const h1 = await health(PORT1);
check('P8.health-200', !!h1 && h1.status === 200, h1 ? `GET /api/health -> ${h1.status}` : 'health never came up (see boot log)');
let p1lines = w31Lines(b1.logFile);
for (let i = 0; i < 10 && p1lines.length === 0 && !b1.child.killed; i++) { await pause(600); p1lines = w31Lines(b1.logFile); }
const s1c = p1lines.filter((l) => !isS3(l) && !isS5(l) && !isS6(l)).length;
const s3c = p1lines.filter(isS3).length;
const s5c = p1lines.filter(isS5).length;
const s6c = p1lines.filter(isS6).length;
check('P8.w31-lines-37', p1lines.length === 37 && s1c === 15 && s3c === 7 && s5c === 8 && s6c === 7,
  `${p1lines.length} W31 boot lines (expected 37): ${s1c} S1 + ${s3c} S3 + ${s5c} S5 + ${s6c} P30 — unchanged by Scope 8`);
check('P8.no-fail-soft', !p1lines.some((l) => l.includes('FAIL-SOFT')), '0 FAIL-SOFT lines across the boot');

/* ================= P9 — zone check (pre-commit) ============================ */
console.log('\n== P9 zone check: git status --short ⊆ named call sites + scripts/phase31-*.mjs ==');
const statusOut = execSync('git status --short', { cwd: ROOT }).toString().split('\n').filter(Boolean).sort();
console.log(statusOut.map((l) => `  ${l}`).join('\n'));
const ALLOWED = [
  'server/mcp/tool-directory.json',          // S8.1 (regenerated)
  'scripts/phase29-scope-b-probe.mjs',       // S8.2 (P1 expectation)
  'scripts/phase30-rules-probe.mjs',         // S8.3 (whitelisted; no edit needed)
  'docs/SERVER-REQUIREMENTS.md',             // S8.4 (hand-maintained note)
  'scripts/regenerate-capabilities.mjs',     // S8.5 (new deliverable)
];
const zoneViolations = statusOut.filter((line) => {
  const file = line.slice(3).trim().replace(/^(.*) -> .*$/, '$1');
  if (ALLOWED.includes(file)) return false;
  if (/^scripts\/phase31-[\w.-]*\.mjs$/.test(file)) return false;
  return true;
});
check('P9.zone-clean', zoneViolations.length === 0, `${statusOut.length} entries, all named call sites / scripts/phase31-*.mjs; violations: ${j(zoneViolations)}`);

/* ================= summary ================================================= */
console.log(`\n== SUMMARY: ${n - FAILS.length}/${n} PASS ==`);
if (FAILS.length) { console.log('FAILURES:'); for (const f of FAILS) console.log(`  - ${f}`); }
try { b1.child.kill('SIGTERM'); } catch { /* already gone */ }
process.exit(FAILS.length ? 1 : 0);

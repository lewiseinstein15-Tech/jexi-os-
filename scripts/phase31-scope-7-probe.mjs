/**
 * JEXI OS — PHASE 31 SCOPE 7 — live probe (P5 + P6; P1–P4 are display probes).
 *
 * P5 regression: 37 W31 boot lines intact (15 S1 + 7 S3 + 8 S5 + 7 P30),
 *                0 FAIL-SOFT, /api/health 200.
 * P6 zone check: git status --short shows only named call sites
 *                (server/package.json, docs/SERVER-REQUIREMENTS.md,
 *                server/src/wiring/phase31-bootstrap.js)
 *                + scripts/phase31-*.mjs.
 *
 * Scope 7 adds no new wiring: S5-CHAIN is a package.json prune,
 * S5-DOCS is a new requirements doc, S5-BOOTSTRAP is a doc comment.
 * Therefore the W31 boot-line count must be UNCHANGED at 37.
 */
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'w31s7-probe-'));
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

/* ================= P5 — regression: 37 W31 boot lines intact =============== */
console.log('== P5 regression: 37 W31 boot lines intact, /api/health 200 ==');
const PORT1 = 5300 + (process.pid % 300) * 2;
const rt1 = path.join(TMP, 'boot1-runtime');
const dt1 = path.join(TMP, 'boot1-data');
const b1 = bootServer(PORT1, rt1, dt1);
const h1 = await health(PORT1);
check('P5.health-200', !!h1 && h1.status === 200, h1 ? `GET /api/health -> ${h1.status}` : 'health never came up (see boot log)');
let p1lines = w31Lines(b1.logFile);
for (let i = 0; i < 10 && p1lines.length === 0 && !b1.child.killed; i++) { await pause(600); p1lines = w31Lines(b1.logFile); }
const s1c = p1lines.filter((l) => !isS3(l) && !isS5(l) && !isS6(l)).length;
const s3c = p1lines.filter(isS3).length;
const s5c = p1lines.filter(isS5).length;
const s6c = p1lines.filter(isS6).length;
console.log(p1lines.map((l) => `  ${l}`).join('\n'));
check('P5.w31-lines-37', p1lines.length === 37 && s1c === 15 && s3c === 7 && s5c === 8 && s6c === 7,
  `${p1lines.length} W31 boot lines (expected 37): ${s1c} S1 + ${s3c} S3 + ${s5c} S5 + ${s6c} P30 — unchanged by Scope 7`);
check('P5.no-fail-soft', !p1lines.some((l) => l.includes('FAIL-SOFT')), '0 FAIL-SOFT lines across the boot');

/* ================= P6 — zone check ========================================= */
console.log('\n== P6 zone check: git status --short ⊆ named call sites + scripts/phase31-*.mjs ==');
const statusOut = execSync('git status --short', { cwd: ROOT }).toString().split('\n').filter(Boolean).sort();
console.log(statusOut.map((l) => `  ${l}`).join('\n'));
const ALLOWED = [
  'server/package.json',                    // S5-CHAIN
  'docs/SERVER-REQUIREMENTS.md',            // S5-DOCS (new file)
  'server/src/wiring/phase31-bootstrap.js', // S5-BOOTSTRAP
];
const zoneViolations = statusOut.filter((line) => {
  const file = line.slice(3).trim().replace(/^(.*) -> .*$/, '$1');
  if (ALLOWED.includes(file)) return false;
  if (/^scripts\/phase31-[\w.-]*\.mjs$/.test(file)) return false;
  return true;
});
check('P6.zone-clean', zoneViolations.length === 0, `${statusOut.length} entries, all named call sites / scripts/phase31-*.mjs; violations: ${j(zoneViolations)}`);

/* ================= summary ================================================= */
console.log(`\n== SUMMARY: ${n - FAILS.length}/${n} PASS ==`);
if (FAILS.length) { console.log('FAILURES:'); for (const f of FAILS) console.log(`  - ${f}`); }
try { b1.child.kill('SIGTERM'); } catch { /* already gone */ }
process.exit(FAILS.length ? 1 : 0);

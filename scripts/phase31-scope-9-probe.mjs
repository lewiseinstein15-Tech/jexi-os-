/**
 * JEXI OS — PHASE 31 SCOPE 9 — live probe (P5 + P6 in-process; Part A/B/C
 * structural double-checks; P1–P4 are command probes pasted in the report).
 *
 * Part A: registry.json — n8n-mcp + forgejo-mcp notes carry the
 *         "[security] declared" prefix, both stay enabled:false, and the
 *         declared set is now 11 (9 existing + these 2). No enables.
 * Part B: README capability table parsed LIVE matches the derived tree
 *         (registry count / enabled count / directory tool sum) — 0 drifts.
 * Part C: docs/DESIGN-DECISIONS.md — ledger with all 10 items, each carrying
 *         What / Why open / Owner. No decisions rendered.
 * P5:     37 W31 boot lines intact (15 S1 + 7 S3 + 8 S5 + 7 P30), 0 FAIL-SOFT,
 *         /api/health 200. Scope 9 is hygiene-only: W31 count UNCHANGED.
 * P6:     zone check — git status --short ⊆ named call sites
 *         + scripts/phase31-*.mjs (run PRE-commit).
 */
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'w31s9-probe-'));
const FAILS = [];
let n = 0;
function check(id, ok, detail) {
  n += 1;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${id} — ${detail}`);
  if (!ok) FAILS.push(`${id}: ${detail}`);
}
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
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

/* ================= Part A — registry hygiene ============================== */
console.log('== Part A: registry.json [security] declared prefixes ==');
const reg = JSON.parse(read('server/mcp/registry.json')).servers;
const n8n = reg.find((s) => s.name === 'n8n-mcp');
const forge = reg.find((s) => s.name === 'forgejo-mcp');
check('A.n8n-declared', !!n8n && String(n8n.notes).startsWith('[security] declared') && n8n.enabled === false,
  `n8n-mcp notes start with "[security] declared" and enabled:false (${n8n ? String(n8n.notes).slice(0, 34) + '…' : 'MISSING'})`);
check('A.forge-declared', !!forge && String(forge.notes).startsWith('[security] declared') && forge.enabled === false,
  `forgejo-mcp notes start with "[security] declared" and enabled:false (${forge ? String(forge.notes).slice(0, 34) + '…' : 'MISSING'})`);
const declared = reg.filter((s) => String(s.notes || '').startsWith('[security] declared'));
check('A.declared-count-11', declared.length === 11,
  `${declared.length} declared entries (expected 11 = 9 existing + n8n-mcp + forgejo-mcp): ${j(declared.map((s) => s.name))}`);
check('A.no-enables', n8n?.enabled === false && forge?.enabled === false,
  'neither n8n-mcp nor forgejo-mcp was enabled');

/* ================= Part B — README capability sync (live) ================= */
console.log('\n== Part B: README capability table vs derived tree (live parse) ==');
const readme = read('README.md');
const num = (label) => {
  const m = readme.match(new RegExp(`\\| ${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\| \\*\\*([\\d,]+(?: \\/ [\\d,]+)?)\\*\\* \\|`));
  return m ? m[1].replace(/,/g, '') : null;
};
const derivedReg = reg.length;
const derivedEnabled = reg.filter((s) => s.enabled !== false).length;
const directory = JSON.parse(read('server/mcp/tool-directory.json')).servers;
const derivedTools = Object.values(directory).reduce((acc, s) => acc + (s.tools?.length || 0), 0);
const readmeRegEnabled = num('MCP servers registered / enabled by default');
const readmeTools = num('Tools exposed by the MCP directory');
const [readmeReg, readmeEnabled] = (readmeRegEnabled || '0 / 0').split(' / ').map(Number);
check('B.mcp-registered', Number(readmeReg) === derivedReg, `README ${readmeReg} vs derived ${derivedReg}`);
check('B.mcp-enabled', Number(readmeEnabled) === derivedEnabled, `README ${readmeEnabled} vs derived ${derivedEnabled}`);
check('B.mcp-directory-tools', Number(readmeTools) === derivedTools, `README ${readmeTools} vs derived ${derivedTools}`);
const drifts = [Number(readmeReg) === derivedReg, Number(readmeEnabled) === derivedEnabled, Number(readmeTools) === derivedTools].filter((x) => !x).length;
check('B.zero-drifts', drifts === 0, `${drifts} drifts between README table and derived values (expected 0)`);

/* ================= Part C — DESIGN-DECISIONS ledger ======================= */
console.log('\n== Part C: docs/DESIGN-DECISIONS.md ledger ==');
let dd = '';
try { dd = read('docs/DESIGN-DECISIONS.md'); } catch { /* missing */ }
const itemHeads = [...dd.matchAll(/^## \d+\. .+$/gm)].map((m) => m[0]);
const blocks = dd.split(/^## \d+\. .+$/m).slice(1);
const complete = blocks.filter((b) => /\*\*What:\*\*/.test(b) && /\*\*Why open:\*\*/.test(b) && /\*\*Owner:\*\*/.test(b)).length;
check('C.ten-items', itemHeads.length === 10, `${itemHeads.length}/10 decision items present`);
check('C.three-fields', complete === 10, `${complete}/10 items carry What / Why open / Owner`);
check('C.ledger-not-decisions', /LEDGER ONLY/.test(dd) && dd.includes('NO DECISIONS MADE HERE'), 'document declares itself a ledger; no decisions rendered');

/* ================= P5 — regression: 37 W31 boot lines intact ============== */
console.log('\n== P5 regression: 37 W31 boot lines intact, /api/health 200 ==');
const PORT1 = 5350 + (process.pid % 300) * 2;
const rt1 = path.join(TMP, 'boot1-runtime');
const dt1 = path.join(TMP, 'boot1-data');
const b1 = bootServer(PORT1, rt1, dt1);
const h1 = await health(PORT1);
check('P5.health-200', !!h1 && h1.status === 200, h1 ? `GET /api/health -> ${h1.status}` : 'health never came up (see boot log)');
let p5lines = w31Lines(b1.logFile);
for (let i = 0; i < 10 && p5lines.length === 0 && !b1.child.killed; i++) { await pause(600); p5lines = w31Lines(b1.logFile); }
const s1c = p5lines.filter((l) => !isS3(l) && !isS5(l) && !isS6(l)).length;
const s3c = p5lines.filter(isS3).length;
const s5c = p5lines.filter(isS5).length;
const s6c = p5lines.filter(isS6).length;
check('P5.w31-lines-37', p5lines.length === 37 && s1c === 15 && s3c === 7 && s5c === 8 && s6c === 7,
  `${p5lines.length} W31 boot lines (expected 37): ${s1c} S1 + ${s3c} S3 + ${s5c} S5 + ${s6c} P30 — unchanged by Scope 9`);
check('P5.no-fail-soft', !p5lines.some((l) => l.includes('FAIL-SOFT')), '0 FAIL-SOFT lines across the boot');

/* ================= P6 — zone check (pre-commit) =========================== */
console.log('\n== P6 zone check: git status --short ⊆ named call sites + scripts/phase31-*.mjs ==');
const statusOut = execSync('git status --short', { cwd: ROOT }).toString().split('\n').filter(Boolean).sort();
console.log(statusOut.map((l) => `  ${l}`).join('\n'));
const ALLOWED = [
  'server/mcp/registry.json',      // Part A ([security] prefixes)
  'README.md',                     // Part B (3 numbers)
  'docs/DESIGN-DECISIONS.md',      // Part C (new ledger)
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

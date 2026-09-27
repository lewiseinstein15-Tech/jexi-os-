#!/usr/bin/env node
/**
 * P11 A3 — profileCoverage cwd SENSITIVITY test.
 *
 * BEFORE: profileCoverage() read server/src/services/Planner.js via
 *         path.join(process.cwd(), 'src/services/Planner.js') and the named
 *         profile dir via path.join(process.cwd(), 'agents/profiles') —
 *         correct ONLY when the process ran with cwd=server; from the repo
 *         root or anywhere else the read failed and the report degraded.
 * AFTER:  every lookup is anchored to import.meta.url — identical results
 *         from ANY cwd.
 *
 * Method: spawn the SAME ES module probe as a fresh node child from THREE
 * different cwds (repo root, server/, /tmp — an unrelated directory) with
 * an ISOLATED DATA_DIR each (so generated-profile state cannot differ), then
 * byte-compare the three JSON reports. Identical => PASS.
 *
 * The probe imports the REAL module (no stubs, no copies).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROBE_SRC = `import { profileCoverage } from '${path.join(ROOT, 'server/src/services/ProfileCompleteness.js').replaceAll("'", "\\'")}';
import fs from 'node:fs';
process.stdout.write(JSON.stringify({ cov: profileCoverage(), profilesDirProbe: fs.readdirSync('${path.join(ROOT, 'server/agents/profiles')}'.replaceAll('//','/')).length }));
`;

const tmpProbe = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'a3-probe-')), 'probe.mjs');
fs.writeFileSync(tmpProbe, PROBE_SRC);

const CWDS = [
  { label: 'repo root', cwd: ROOT },
  { label: 'server/', cwd: path.join(ROOT, 'server') },
  { label: 'unrelated (/tmp)', cwd: os.tmpdir() },
];

const runs = [];
let failed = false;
for (const { label, cwd } of CWDS) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'a3-data-'));
  const r = spawnSync(process.execPath, [tmpProbe], {
    cwd,
    encoding: 'utf8',
    timeout: 60000,
    env: { ...process.env, DATA_DIR: dataDir },
  });
  if (r.status !== 0 || !r.stdout) {
    console.log(`[FAIL] A3 cwd=${label} — probe exited ${r.status}\nstderr: ${(r.stderr || '').slice(-400)}`);
    failed = true;
    runs.push(null);
    continue;
  }
  runs.push(r.stdout.trim());
  console.log(`[run] cwd=${label}`);
  console.log(r.stdout.trim());
}

if (!failed) {
  const [root, server, unrelated] = runs;
  const identical = root === server && server === unrelated;
  console.log('');
  console.log(`root == server:      ${root === server}`);
  console.log(`server == unrelated: ${server === unrelated}`);
  console.log(`[${identical ? 'PASS' : 'FAIL'}] A3 profileCoverage cwd-independence — 3 cwds produce ${identical ? 'BYTE-IDENTICAL' : 'DIFFERENT'} results`);
  process.exit(identical ? 0 : 1);
}
process.exit(1);

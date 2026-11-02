/**
 * M16 Phase 3 - run every completion-integrity scenario and print a table.
 *
 * Each scenario is a separate process (scenario.mjs) because runTaskWithJexi
 * mutates process.env.WORKSPACE_DIR and JEXI's AgentLoop keeps one global
 * turn; sharing a process lets an orphaned loop from a timed-out scenario
 * write into the next scenario's sandbox.
 *
 * Usage: MODEL_PROVIDER=ollama node run-all.mjs
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCENARIOS = [
  'write', 'claim-no-tool', 'failed-write', 'write-then-test',
  'all-fail', 'dead-provider', 'test-run-verified',
];

let pass = 0;
const rows = [];
for (const s of SCENARIOS) {
  const r = spawnSync(process.execPath, [path.join(here, 'scenario.mjs'), s], {
    encoding: 'utf8', env: process.env, timeout: 150000,
  });
  const json = (r.stdout || '').slice((r.stdout || '').indexOf('{'));
  let d = null;
  try { d = JSON.parse(json); } catch { /* leave null */ }
  const ok = r.status === 0 && d?.pass === true;
  if (ok) pass += 1;
  rows.push({ s, ok, d });
}

const width = Math.max(...rows.map((x) => x.s.length));
for (const { s, ok, d } of rows) {
  const a = d?.actual || {};
  console.log(
    `${s.padEnd(width)}  ${ok ? 'PASS' : 'FAIL'}  ` +
    `file=${String(a.fileExists).padEnd(5)} unverified=${String(a.unverified).padEnd(5)} ` +
    `verification=${a.verification ?? '-'}  calls=${JSON.stringify(a.providerCalls ?? [])}`,
  );
}
console.log(`\n${pass}/${rows.length} scenarios passed`);
process.exit(pass === rows.length ? 0 : 1);

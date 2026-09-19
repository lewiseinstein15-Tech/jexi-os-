// PHASE 21 — SCOPE C — LIVE PROBE: human-editable program.md.
// Zone-compliant: the simulated human edit writes a COPY into the .probes
// sandbox — the probe never edits research/program/program.md itself, because
// agent-side edits to it are exactly what Scope B forbids.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';

import { loadProgram } from '../research/program/load.js';
import { guardEdit } from '../research/constraints/guards.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const programPath = join(root, 'research', 'program', 'program.md');

const probesDir = join(root, 'research', '.probes');
mkdirSync(probesDir, { recursive: true });
const tmp = mkdtempSync(join(probesDir, 'scope-c-'));
const humanEditedCopy = join(tmp, 'program-edited.md');

try {
  // ---- 1. load the real program.md ----
  const p1 = await loadProgram(programPath);
  console.log(`[load 1] ok=${p1.ok} constraints=${p1.constraints.length}`);
  console.log('[load 1] strategy:');
  for (const line of p1.strategy.split('\n')) console.log(`  | ${line}`);
  console.log('[load 1] constraints:');
  for (const c of p1.constraints) console.log(`  - ${c}`);

  // ---- 2. simulated HUMAN edit: change one strategy line on a copy ----
  const original = await (await import('node:fs/promises')).readFile(programPath, 'utf8');
  const edited = original.replace(
    'Prefer single-parameter changes over structural rewrites: one knob per\nexperiment, so keep/discard verdicts attribute cleanly.',
    'Prefer architectural rewrites when single-parameter gains have stalled:\nthree consecutive discards open a structure cycle.',
  );
  if (edited === original) throw new Error('probe bug: strategy line replacement did not apply');
  writeFileSync(humanEditedCopy, edited, 'utf8');

  const p2 = await loadProgram(humanEditedCopy);
  console.log(`\n[load 2] after human edit — ok=${p2.ok} constraints=${p2.constraints.length}`);
  console.log('[load 2] strategy:');
  for (const line of p2.strategy.split('\n')) console.log(`  | ${line}`);

  // ---- 3. reload the original: fresh per-cycle read, no stale cache ----
  const p3 = await loadProgram(programPath);
  console.log(`\n[load 3] reload original — ok=${p3.ok}`);
  console.log(`[load 3] strategy first line: ${p3.strategy.split('\n')[0]}`);

  // ---- 4. the agent itself cannot edit program.md (Scope B integration) ----
  const v = guardEdit(programPath, { operation: 'edit' });
  console.log(`\n[guard] agent edit of program.md -> ${v.allowed ? 'ALLOWED' : `BLOCKED — ${v.reason}`}`);

  // ---- 5. malformed input is honest ----
  const bad = await loadProgram(join(tmp, 'missing.md'));
  console.log(`[bad] missing file -> ok=${bad.ok} error=${bad.error}`);

  // ---- assertions ----
  assert.equal(p1.ok, true);
  assert.ok(p1.strategy.includes('val_metric'), 'strategy must mention the metric');
  assert.ok(p1.constraints.some((c) => c.startsWith('judge:')), 'constraints must bind the judge');
  assert.ok(p2.strategy.includes('architectural rewrites'), 'edited strategy must show');
  assert.ok(!p2.strategy.includes('single-parameter changes'), 'old strategy line must be gone');
  assert.equal(p2.constraints.length, p1.constraints.length, 'human edit only touched Strategy');
  assert.equal(p3.ok, true);
  assert.ok(p3.strategy.includes('single-parameter changes'), 'reload shows original strategy (no cache)');
  assert.equal(v.allowed, false, 'agent must be blocked from editing program.md');
  assert.match(v.reason, /read-only/);
  assert.equal(bad.ok, false);

  console.log('\nSCOPE C PROBE PASSED');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

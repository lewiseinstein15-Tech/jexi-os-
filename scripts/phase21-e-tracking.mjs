// PHASE 21 — SCOPE E — LIVE PROBE: dual tracking in a throwaway git repo.
// The reset semantics run for real — inside research/.probes only, never the
// host JEXI repository (createFrontier refuses that by construction).
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert';

import { createDualTracker } from '../research/tracking/dual.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const probesDir = join(root, 'research', '.probes');
const ws = mkdtempSync(join(probesDir, 'scope-e-'));
const resultsPath = join(ws, 'results.tsv');

function sh(cmd, args) {
  return execFileSync(cmd, args, { cwd: ws, encoding: 'utf8' }).trim();
}

try {
  // init throwaway experiment workspace
  sh('git', ['init', '-q', '-b', 'frontier']);
  sh('git', ['config', 'user.email', 'research@jexi.local']);
  sh('git', ['config', 'user.name', 'jexi-research']);
  writeFileSync(join(ws, 'candidate.js'), 'baseline\n');
  sh('git', ['add', '-A']);
  sh('git', ['commit', '-q', '-m', 'baseline']);

  const dual = createDualTracker({ repoDir: ws, resultsPath, branch: 'frontier' });

  // 3 simulated experiments: 2 no-improve, 1 improve (kept order: e2 is the keeper)
  const experiments = [
    { id: 'exp-1', kept: false, metric: 1.037, previousBest: 1.022, evidence: { exitCode: 0, durationMs: 101 } },
    { id: 'exp-2', kept: true, metric: 1.0001, previousBest: 1.022, evidence: { exitCode: 0, durationMs: 98 } },
    { id: 'exp-3', kept: false, metric: 1.026, previousBest: 1.0001, evidence: { exitCode: 0, durationMs: 95 } },
  ];

  for (const exp of experiments) {
    // model the real lifecycle: the mutation is in the workspace BEFORE the verdict —
    // kept means the winning content stands (commit has a real diff), discarded
    // means regressed content gets reset away.
    writeFileSync(join(ws, 'candidate.js'), exp.kept ? `winner-${exp.id}\n` : `regressed-${exp.id}\n`);
    const res = await dual.track(exp);
    console.log(
      `[track] ${exp.id} verdict=${res.verdict} action=${res.action}${res.commit ? ` commit=${res.commit.slice(0, 7)}` : ''} note="${res.row.note}"`,
    );
  }

  // ---- raw view: frontier git history ----
  console.log('\n--- git log (frontier branch) ---');
  console.log(sh('git', ['log', '--oneline', 'frontier']));

  // ---- raw view: results.tsv ----
  console.log('\n--- cat results.tsv ---');
  console.log(await (await import('node:fs/promises')).readFile(resultsPath, 'utf8').then((t) => t.replace(/\t/g, ' | ')));
  console.log('--- raw tab-separated bytes ---');
  console.log(sh('cat', ['results.tsv']));

  // ---- workspace cleanliness: discards must not leave residue ----
  console.log(`\n--- workspace status after all experiments: ${JSON.stringify(sh('git', ['status', '--porcelain']))} ---`);
  console.log(`--- candidate.js content at tip: ${JSON.stringify(sh('cat', ['candidate.js']))} ---`);

  // ---- assertions ----
  const frontierLog = sh('git', ['log', '--oneline', 'frontier']).split('\n');
  assert.equal(frontierLog.length, 2, 'frontier must hold exactly baseline + the kept experiment');
  assert.match(frontierLog[0], /exp-2 \(kept\)/, 'frontier tip must be the kept experiment');

  const rows = await dual.log.rows();
  assert.equal(rows.length, 3, 'results.tsv must hold ALL 3 experiments');
  assert.equal(rows[0].verdict, 'discarded');
  assert.equal(rows[1].verdict, 'kept');
  assert.equal(rows[2].verdict, 'discarded');
  assert.ok(rows[0].metric !== '' && rows[1].metric !== '');
  assert.ok(Number(rows[1].delta) < 0, 'kept experiment must show a negative delta (improvement)');
  assert.equal(sh('cat', ['candidate.js']), 'winner-exp-2', 'frontier tip must hold the kept experiment\'s winning content; exp-3 residue must be reset away');

  console.log('\nSCOPE E PROBE PASSED');
} finally {
  rmSync(ws, { recursive: true, force: true });
}

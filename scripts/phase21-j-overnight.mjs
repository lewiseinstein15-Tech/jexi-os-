// PHASE 21 — SCOPE J — LIVE PROBE: overnight autonomous run, 10 seconds max.
// Zone-compliant: experiment workspace + results.tsv + git frontier all under
// research/.probes (throwaway repo, like Scope E), removed in finally.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';

import { runOvernight } from '../research/overnight.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const probesDir = join(root, 'research', '.probes');
mkdirSync(probesDir, { recursive: true });
const dir = mkdtempSync(join(probesDir, 'scope-j-'));
const experimentDir = join(dir, 'workspace');
const repoDir = experimentDir; // the frontier repo IS the experiment workspace
const resultsPath = join(experimentDir, 'results.tsv'); // inside the repo, neverTrack'd
mkdirSync(experimentDir);

const fixtureDir = join(root, 'research', 'fixtures', 'toy-target');
const candidatePath = join(experimentDir, 'candidate.js');
const baseline = readFileSync(join(fixtureDir, 'candidate.js'), 'utf8');

function sh(cmd, args) {
  return execFileSync(cmd, args, { cwd: repoDir, encoding: 'utf8' }).trim();
}

try {
  // ---- start trigger: fresh workspace + frontier repo ----
  writeFileSync(candidatePath, baseline);
  sh('git', ['init', '-q', '-b', 'frontier']);
  sh('git', ['config', 'user.email', 'research@jexi.local']);
  sh('git', ['config', 'user.name', 'jexi-research']);
  sh('git', ['add', '-A']);
  sh('git', ['commit', '-q', '-m', 'baseline']);

  // ---- 8 scheduled experiments: n2 improves (0.7x+0.21), n4 improves again
  // (0.7x+0.2 — exactly the latent function), n5-n7 stall, maxStalled stops it ----
  const experiments = [
    { name: 'n1-steeper', content: 'export function predict(x) {\n  return 1.5 * x + 0.0;\n}\n' },
    { name: 'n2-true-slope', content: 'export function predict(x) {\n  return 0.7 * x + 0.21;\n}\n' },
    { name: 'n3-flatter', content: 'export function predict(x) {\n  return 0.4 * x + 0.5;\n}\n' },
    { name: 'n4-exact', content: 'export function predict(x) {\n  return 0.7 * x + 0.2;\n}\n' },
    { name: 'n5-noisy', content: 'export function predict(x) {\n  return 0.75 * x + 0.17;\n}\n' },
    { name: 'n6-stale', content: 'export function predict(x) {\n  return 0.7 * x + 0.2;\n}\n' },
    { name: 'n7-stale', content: 'export function predict(x) {\n  return 0.7 * x + 0.2;\n}\n' },
    { name: 'n8-never-reached', content: 'export function predict(x) {\n  return 0.6 * x + 0.4;\n}\n' },
  ];

  const t0 = Date.now();
  const report = await runOvernight(
    { experimentDir, command: ['node', join(fixtureDir, 'train.js')], env: { TOY_CANDIDATE: candidatePath } },
    {
      experiments,
      maxIterations: 8,
      maxWallMs: 10_000, // the phase's bound: 10 seconds max
      maxStalled: 3, // program.md strategy: stop after 2 consecutive discards + 1
      budgetMs: 5_000, // per-experiment wall-clock budget (Scope D semantics)
      programPath: join(root, 'research', 'program', 'program.md'),
      repoDir,
      resultsPath,
      initialBest: 1.0222,
    },
  );
  const wall = Date.now() - t0;

  // ---- wake-up report (raw) ----
  console.log('=== WAKE-UP REPORT ===');
  console.log(JSON.stringify(report, null, 2));
  console.log(`\n[wall-clock] run finished in ${wall}ms (bound 10000ms)`);
  console.log(`[frontier] git log:`);
  console.log(sh('git', ['log', '--oneline', 'frontier']));
  console.log(`\n[log] results.tsv:`);
  console.log(sh('cat', ['results.tsv']));
  const finalCandidate = readFileSync(candidatePath, 'utf8');
  console.log(`\n[candidate] content standing at the frontier: ${JSON.stringify(finalCandidate.trim())}`);

  // ---- assertions ----
  assert.ok(wall < 10_000, 'run must respect the 10s bound');
  assert.equal(report.stoppedBecause, 'maxStalled', 'the no-improvement streak must stop the loop');
  assert.equal(report.ran, 7, 'n5,n6,n7 are three consecutive discards; n8 is never reached');
  assert.equal(report.kept, 2, 'n2 and n4 are the keepers (two frontier advances)');
  assert.equal(report.discarded, 5);
  assert.equal(report.frontierAdvanced, true, 'frontier must advance past initialBest');
  assert.ok(report.frontierBest < 1.01, 'frontier best must land near the latent optimum');
  assert.equal(report.overBudgetExperiments, 0);
  assert.equal(report.program.ok, true, 'program.md must load');
  assert.ok(report.program.constraints >= 7);
  const rows = sh('cat', ['results.tsv']).split('\n').filter((l) => l && !l.startsWith('experimentId'));
  assert.equal(rows.length, report.ran, 'complete log: one row per experiment run');
  const frontierCommits = sh('git', ['log', '--oneline', 'frontier']).split('\n');
  assert.equal(frontierCommits.length, 3, 'frontier = baseline + 2 kept experiments');
  assert.ok(finalCandidate.includes('0.7 * x + 0.2;'), 'the best mutation (n4-exact) must stand in the candidate');
  assert.ok(report.dual.frontierTip, 'dual tracking reports the frontier tip');

  console.log('\nSCOPE J PROBE PASSED');
} finally {
  rmSync(dir, { recursive: true, force: true });
}

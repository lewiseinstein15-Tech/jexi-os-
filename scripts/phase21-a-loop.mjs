// PHASE 21 — SCOPE A — LIVE PROBE: experiment loop against a toy target.
// Zone-compliant: writes only a self-cleaning temp dir under research/.probes/.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';

import { runExperiment } from '../services/research/loop/lifecycle.js';
import { runLoop } from '../services/research/loop/experiment-loop.js';
import { runScheduled } from '../services/research/loop/scheduler.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureDir = join(root, 'research', 'fixtures', 'toy-target');
const probesDir = join(root, 'research', '.probes');
mkdirSync(probesDir, { recursive: true });
const experimentDir = mkdtempSync(join(probesDir, 'scope-a-'));
const candidatePath = join(experimentDir, 'candidate.js');

const baseline = readFileSync(join(fixtureDir, 'candidate.js'), 'utf8');
writeFileSync(candidatePath, baseline);

const command = ['node', join(fixtureDir, 'train.js')];
const env = { TOY_CANDIDATE: candidatePath };
const fmt = (v) => (v === null || v === undefined ? 'null' : Number(v).toFixed(6));

try {
  // ---- baseline (no mutation): sets the initial frontier ----
  const base = await runExperiment({ id: 'baseline', experimentDir, command, env });
  console.log(
    `[baseline] status=${base.status} metric=${fmt(base.metric)} exit=${base.evidence.exitCode} durationMs=${base.evidence.durationMs}`,
  );
  console.log(`[baseline] candidate restored/no-op, frontier set to ${fmt(base.metric)}`);

  // ---- 3 experiments: worse -> discard | better -> keep | worse -> discard ----
  const mutations = [
    {
      name: 'exp-1-steeper',
      worse: true,
      content: 'export function predict(x) {\n  return 1.5 * x + 0.0;\n}\n',
    },
    {
      name: 'exp-2-true-slope',
      worse: false,
      content: 'export function predict(x) {\n  return 0.7 * x + 0.2;\n}\n',
    },
    {
      name: 'exp-3-flatter',
      worse: true,
    content: 'export function predict(x) {\n  return 0.3 * x + 0.6;\n}\n',
    },
  ];

  const events = [];
  for await (const ev of runLoop(
    { experimentDir, command, env },
    {
      maxIterations: 3,
      initialBest: base.metric,
      makeExperiment: (i) => {
        const m = mutations[i - 1];
        return m
          ? { name: m.name, mutate: async (p) => writeFileSync(p, m.content) }
          : null;
      },
      onKeep: (r) => console.log(`  -> KEEP    ${r.id} metric=${fmt(r.metric)} (mutation stands)`),
      onDiscard: (r) =>
        console.log(`  -> DISCARD ${r.id} metric=${fmt(r.metric)} (candidate restored)`),
    },
  )) {
    events.push(ev);
    console.log(
      `[iter ${ev.iteration}] status=${ev.status} metric=${fmt(ev.metric)} kept=${ev.kept}`,
    );
  }

  const iters = events.filter((e) => e.status !== 'complete');
  const complete = events.find((e) => e.status === 'complete');
  console.log(
    `[complete] iterations=${complete.iteration} best=${fmt(complete.metric)} (loop terminated after maxIterations)`,
  );

  // ---- bounded scheduler run: fresh dir so its kept mutations can stand ----
  const schedDir = mkdtempSync(join(probesDir, 'scope-a-sched-'));
  writeFileSync(join(schedDir, 'candidate.js'), baseline);
  const schedEnv = { TOY_CANDIDATE: join(schedDir, 'candidate.js') };
  const summary = await runScheduled(
    { experimentDir: schedDir, command, env: schedEnv },
    {
      maxIterations: 2,
      initialBest: null,
      makeExperiment: (i) => ({
        name: `sched-${i}`,
        mutate: async (p) =>
          writeFileSync(p, `export function predict(x) {\n  return ${0.75 - 0.05 * i} * x + ${0.15 + 0.05 * i};\n}\n`),
      }),
    },
  );
  console.log(`[scheduler] ${JSON.stringify(summary)}`);

  // ---- assertions ----
  assert.equal(iters.length, 3, 'loop must run exactly maxIterations=3 experiments');
  assert.equal(iters[0].status, 'discarded', 'exp1 must be discarded (no-improve)');
  assert.equal(iters[1].status, 'kept', 'exp2 must be kept (improve)');
  assert.equal(iters[2].status, 'discarded', 'exp3 must be discarded (no-improve)');
  assert.ok(iters[1].metric < base.metric, 'kept metric must beat the baseline');
  assert.ok(iters[0].metric > base.metric, 'exp1 must be worse than baseline');
  assert.equal(complete.status, 'complete');
  assert.equal(complete.metric, iters[1].metric, 'frontier metric = best kept metric');
  const restored = readFileSync(candidatePath, 'utf8');
  assert.ok(
    restored.includes('0.7 * x + 0.2') && !restored.includes('0.69'),
    'after discarded exp-1/exp-3 the kept exp-2 content must stand in the candidate file',
  );
  assert.equal(summary.iterations, 2);
  assert.equal(summary.stoppedBecause, 'maxIterations');
  assert.equal(summary.kept, 1, 'only sched-1 (0.70x+0.20) beats its run-1 frontier');
  assert.ok(summary.best < 1.01, 'scheduler frontier must land near the latent optimum');

  console.log('SCOPE A PROBE PASSED');
} finally {
  rmSync(experimentDir, { recursive: true, force: true });
}

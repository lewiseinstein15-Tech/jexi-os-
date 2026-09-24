// research/loop/lifecycle.js
// One experiment's full lifecycle:
//   snapshot candidate -> apply mutation -> run target command -> parse metric
//   -> keep (mutation stands) or discard (restore snapshot) -> report.
//
// Pattern after karpathy/autoresearch (MIT): the agent edits exactly one file
// (there train.py, here the candidate file), a fixed judge evaluates it, and the
// metric (there val_bpb, here val_metric) decides keep vs discard. Git-level
// commit/reset wiring lives in research/tracking (Scope E); the wall-clock
// budget lands in research/budget (Scope D). This module stays the seam.

import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

// Last `val_metric=<number>` line wins (the judge prints exactly one on success).
const METRIC_RE = /val_metric=([-+0-9.eE]+)/g;

export function parseMetric(stdout) {
  let last = null;
  for (const m of stdout.matchAll(METRIC_RE)) last = m;
  if (!last) return null;
  const value = Number(last[1]);
  return Number.isFinite(value) ? value : null;
}

// Real subprocess run. No `run` injection needed here — the command itself is the
// seam (callers pass any argv they like). exitCode is the raw child code; a spawn
// failure reports -1.
export function runCommand(argv, { cwd, env = {}, timeoutMs = null } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(argv[0], argv.slice(1), {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let timedOut = false;
    const timer =
      timeoutMs != null
        ? setTimeout(() => {
            timedOut = true;
            child.kill('SIGKILL');
          }, timeoutMs)
        : null;
    child.stdout.on('data', (d) => {
      stdout += d;
    });
    child.stderr.on('data', (d) => {
      stdout += d;
    });
    const finish = (exitCode) => {
      if (timer) clearTimeout(timer);
      resolve({ stdout, exitCode, durationMs: Date.now() - started, timedOut });
    };
    child.on('error', (err) => {
      stdout += String(err?.stack ?? err);
      finish(-1);
    });
    child.on('close', (code) => finish(code ?? -1));
  });
}

// CONTRACT
//   runExperiment(config) -> Promise<{
//     kept: boolean,
//     metric: number | null,
//     previousBest: number | null,
//     evidence: { stdout, exitCode, durationMs },
//     id, status, crashed
//   }>
// config: { id, experimentDir, candidateFile, command(argv), env, mutate(candidatePath),
//           previousBest, timeoutMs, onKeep(result), onDiscard(result) }
export async function runExperiment(config) {
  const {
    id = 'experiment',
    experimentDir,
    candidateFile = 'candidate.js',
    command,
    env = {},
    mutate = null,
    previousBest = null,
    timeoutMs = null,
    onKeep = null,
    onDiscard = null,
  } = config;

  const candidatePath = join(experimentDir, candidateFile);
  const snapshot = await readFile(candidatePath, 'utf8');

  if (mutate) await mutate(candidatePath);

  const run = await runCommand(command, { cwd: experimentDir, env, timeoutMs });
  const metric = run.timedOut ? null : parseMetric(run.stdout);
  const crashed = run.timedOut || run.exitCode !== 0 || metric === null;
  const kept = !crashed && (previousBest === null || metric < previousBest);

  const evidence = { stdout: run.stdout, exitCode: run.exitCode, durationMs: run.durationMs };

  if (kept) {
    if (onKeep) await onKeep({ id, metric, previousBest, evidence, kept, crashed });
  } else {
    // Discard: the mutation did not improve the frontier — restore the snapshot.
    await writeFile(candidatePath, snapshot, 'utf8');
    if (onDiscard) await onDiscard({ id, metric, previousBest, evidence, kept, crashed });
  }

  return {
    id,
    kept,
    metric,
    previousBest,
    evidence,
    crashed,
    status: crashed ? 'crashed' : kept ? 'kept' : 'discarded',
  };
}

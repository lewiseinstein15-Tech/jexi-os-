/**
 * JEXI OS — benchmarks/humaneval-live/run.mjs
 *
 * Reproducible, externally grounded coding-agent measurement.
 *
 *   node benchmarks/humaneval-live/run.mjs --leg gold   --tasks 20
 *   node benchmarks/humaneval-live/run.mjs --leg jexi   --tasks 20
 *   node benchmarks/humaneval-live/run.mjs --leg jexi   --tasks 20 --schema as-shipped
 *
 * The benchmark is HumanEval (openai/openai_humaneval, split test), pinned on
 * disk by sha256. Every result is written to a JSON manifest that records the
 * dataset revision, model identity, harness git commit and per-task verdicts,
 * so the number can be checked by anyone with the same commit.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { loadDataset, materialiseTask, gradeLocally } from './lib/tasks.mjs';
import { runTaskWithJexi, runGoldTask } from './lib/agent.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

function arg(name, dflt = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : dflt;
}
const hasFlag = (name) => process.argv.includes(`--${name}`);

function gitRev() {
  try { return execFileSync('git', ['-C', REPO, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { return null; }
}
function gitDirty() {
  try { return execFileSync('git', ['-C', REPO, 'status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0; } catch { return null; }
}

/**
 * Resolve how to reach the Docker CLI, or null if there is no daemon.
 * Returns the command prefix (`[]` for bare `docker`, `['sudo']` when the
 * socket is root-owned). A null result is not fatal — grading falls back to
 * the local grader and the manifest records that.
 */
function dockerCmd() {
  const probe = spawnSync('docker', ['info'], { encoding: 'utf8', timeout: 15_000 });
  if (probe.status === 0) return [];
  const sudo = spawnSync('sudo', ['docker', 'info'], { encoding: 'utf8', timeout: 15_000 });
  if (sudo.status === 0) return ['sudo'];
  return null;
}

/**
 * Grade one sandbox. Prefers the hermetic Docker grader (`--network none`);
 * falls back to the unisolated local grader, recording which was used so the
 * manifest never overstates the rigor of the number.
 */
function gradeOne({ dockerPrefix, ...rest }) {
  if (dockerPrefix) {
    const [bin, ...pre] = [...dockerPrefix, 'docker'];
    const res = spawnSync(bin, [...pre, 'run', '--rm', '--network', 'none', '-v', `${rest.sandboxDir}:/w`, '-w', '/w',
      rest.image || 'python:3.11-slim', 'python', 'grade.py', rest.solutionName, rest.testName, rest.entryPoint],
      { encoding: 'utf8', timeout: rest.timeoutMs || 120_000 });
    const output = `${res.stdout || ''}${res.stderr || ''}`.trim();
    if (!res.error && res.status !== null) {
      return { passed: res.status === 0, output, exitCode: res.status, isolated: true, error: null };
    }
    console.warn(`[bench] docker grade failed for ${rest.sandboxDir}, falling back to local: ${res.error?.message || 'no status'}`);
  }
  const local = gradeLocally(rest);
  return { ...local, isolated: false };
}

async function main() {
  const leg = arg('leg', 'gold');
  const limit = Number(arg('tasks', '20'));
  const schemaMode = arg('schema', 'documented');
  // `code-write` / `code-run` are classified `risky`, and JEXI's shipped
  // `auto` AND `coding` profiles both block risky tools — so a coding task
  // cannot be completed under either. `full` is the least-permissive shipped
  // profile that permits the write/run tools the task needs, so it is the
  // default here; the permission axis is measured separately via --profile.
  const toolProfile = arg('profile', 'full');
  const perTaskTimeoutMs = Number(arg('timeout', '150')) * 1000;
  const model = process.env.BENCH_MODEL || null;
  const runId = `humaneval-${leg}-${schemaMode}-${new Date().toISOString().replace(/[:.]/g, '-')}`;

  const { tasks, sha256, dataset } = loadDataset();
  const selected = tasks.slice(0, limit);

  const dockerPrefix = dockerCmd();
  console.log(`[bench] leg=${leg} schema=${schemaMode} tasks=${selected.length} grader=${dockerPrefix ? (dockerPrefix.length ? 'sudo docker' : 'docker') : 'local (unisolated)'}`);
  console.log(`[bench] dataset sha256=${sha256} total=${dataset.num_rows_total}`);

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'humaneval-live-'));
  const rows = [];

  for (const task of selected) {
    const sandboxDir = path.join(tmpRoot, task.task_id.replace('/', '_'));
    materialiseTask(task, sandboxDir);
    const testName = `test_${task.entry_point}.py`;
    const t0 = Date.now();

    let agentInfo = {};
    if (leg === 'gold') {
      runGoldTask({ task, sandboxDir });
    } else if (leg === 'jexi') {
      agentInfo = await runTaskWithJexi({ task, sandboxDir, schemaMode, toolProfile, timeoutMs: perTaskTimeoutMs, log: () => {} });
    } else {
      throw new Error(`unknown leg "${leg}"`);
    }

    const graded = gradeOne({ dockerPrefix, sandboxDir, solutionName: 'solution.py', testName, entryPoint: task.entry_point });
    const durationMs = Date.now() - t0;

    const row = {
      taskId: task.task_id,
      entryPoint: task.entry_point,
      pass: graded.passed,
      durationMs,
      gradedIsolated: graded.isolated,
      gradeOutput: graded.output.slice(-800),
      agentError: agentInfo.error || null,
      intent: agentInfo.intent || null,
      models: agentInfo.models || null,
      offeredTools: agentInfo.offeredTools || null,
      toolCalls: (agentInfo.toolCalls || []).map((c) => ({ name: c.name, args: String(c.args || '').slice(0, 300) })),
      toolResults: (agentInfo.toolResults || []).map((r) => ({ name: r.name, ok: r.ok, error: r.error ? String(r.error).slice(0, 200) : null })),
      stats: agentInfo.stats || null,
      solutionHead: (agentInfo.solution || '').slice(0, 400),
    };
    rows.push(row);
    console.log(`  ${graded.passed ? 'PASS' : 'FAIL'}  ${task.task_id.padEnd(16)} ${String(durationMs).padStart(7)}ms  tools=${row.toolCalls.length}  ${agentInfo.error ? 'agentError=' + agentInfo.error.slice(0, 60) : ''}`);
  }

  const passed = rows.filter((r) => r.pass).length;
  const resolved = rows.length ? passed / rows.length : 0;

  const manifest = {
    benchmark: 'humaneval',
    dataset: { repo: dataset.name, config: dataset.config, split: dataset.split, sha256, numRowsTotal: dataset.num_rows_total },
    leg,
    schemaMode,
    toolProfile,
    model: model || 'provider-ladder (keyless floor: kilo/pollinations)',
    tasks: selected.length,
    taskIds: selected.map((t) => t.task_id),
    gitCommit: gitRev(),
    gitDirty: gitDirty(),
    grader: dockerPrefix ? 'docker --network none' : 'local subprocess (NOT isolated)',
    gradedWithoutIsolation: !dockerPrefix,
    dockerImage: dockerPrefix ? 'python:3.11-slim' : null,
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    startedAt: new Date().toISOString(),
    runId,
  };
  const result = {
    manifest,
    resolved,
    passed,
    failed: rows.length - passed,
    rows,
  };

  fs.mkdirSync(path.join(HERE, 'results'), { recursive: true });
  const outPath = path.join(HERE, 'results', `${runId}.json`);
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(`\n[bench] ${leg}/${schemaMode}: resolved ${passed}/${rows.length} = ${(resolved * 100).toFixed(1)}%`);
  console.log(`[bench] wrote ${outPath}`);
}

main().then(
  () => process.exit(0), // JEXI's runtime leaves health-check timers armed; exit explicitly so a finished run ends.
  (e) => { console.error('[bench] FATAL', e); process.exit(1); },
);

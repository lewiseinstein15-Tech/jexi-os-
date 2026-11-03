/**
 * M20 — CONDITION B: bounded test-driven repair driver.
 *
 * Reuses the REAL agent loop (`runTaskWithJexi`) and the OFFICIAL grader
 * (`gradeLocally`) — it does NOT re-implement either, and it does NOT touch the
 * completion gate (`scoreTask`). What it adds is the missing loop the M20
 * mission asks about: run → grade → (on failure) feed the ACTUAL failing-test
 * output back → run again → re-grade, bounded to a strict maximum of two
 * repairs per task.
 *
 * Safety properties (see docs/M20-FINDINGS.md):
 *   - max 2 repairs per task (MAX_REPAIRS), enforced in the loop;
 *   - the model never grades itself — the OFFICIAL grader decides every attempt;
 *   - a generated explanation is never accepted as a repair; only a green
 *     official grade ends the loop;
 *   - the failing-test output handed to the model is the grader's own output,
 *     scrubbed of anything that looks like a credential;
 *   - the same sandbox, tool profile, permissions and timeout are reused;
 *   - the official test file is never modified (the grader runs it unchanged).
 *
 * Per task it records EVERY attempt's verdict, so the paired comparison against
 * Condition A (first attempt = A, final attempt = B) is exact on the same slice.
 *
 * Usage (identical env to m20-capture.mjs):
 *   node benchmarks/humaneval-live/m20-repair.mjs --tasks 15 --timeout 300 --profile full --repairs 2
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { loadDataset, materialiseTask, gradeLocally } from './lib/tasks.mjs';
import { runTaskWithJexi, buildQuery, taskPaths } from './lib/agent.mjs';
import { scoreTask, summarise } from './lib/score.mjs';
import { runBoundedRepair, MAX_REPAIRS } from './lib/repair.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');


function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}
function gitRev() {
  try { return execFileSync('git', ['-C', REPO, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { return null; }
}
function gitDirty() {
  try { return execFileSync('git', ['-C', REPO, 'status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0; } catch { return null; }
}

/** Strip anything credential-shaped from text handed back to the model. */
function scrub(text) {
  return String(text || '')
    .replace(/\b(sk|pk|ghp|gho|xox[baprs])[-_A-Za-z0-9]{12,}/g, '[redacted]')
    .replace(/\b[A-Z0-9_]*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)[A-Z0-9_]*\s*[:=]\s*\S+/gi, '$1=[redacted]')
    .replace(/Authorization:\s*\S+/gi, 'Authorization: [redacted]');
}

/** Build the repair query: the REAL failing-test output + the current file. */
function buildRepairQuery({ task, solutionPath, testName, currentSolution, gradeOutput, attempt }) {
  return [
    `Your previous attempt to implement the Python function ${task.entry_point} FAILED the official test (repair attempt ${attempt} of ${MAX_REPAIRS}).`,
    '',
    'The function you must implement (exact name and signature):',
    '```python',
    task.prompt.trim(),
    '```',
    '',
    'The file on disk currently contains:',
    '```python',
    String(currentSolution || '(empty)').slice(0, 4000),
    '```',
    '',
    'The OFFICIAL test output was:',
    '```',
    scrub(gradeOutput).slice(-2000),
    '```',
    '',
    `Fix the IMPLEMENTATION so the test passes. Keep the exact function name (${task.entry_point}) and signature.`,
    'Put any imports at the top of the file. Do NOT modify the test file — the fix is in the implementation.',
    `Use the code-write tool to write the corrected full file to ${solutionPath}, then use the code-run tool to run ${testName} and confirm it passes.`,
  ].join('\n');
}

async function main() {
  const limit = Number(arg('tasks', '15'));
  const perTaskTimeoutMs = Number(arg('timeout', '300')) * 1000;
  const toolProfile = arg('profile', 'full');
  const schemaMode = arg('schema', 'as-shipped');
  const maxRepairs = Math.min(MAX_REPAIRS, Number(arg('repairs', String(MAX_REPAIRS))));
  const model = process.env.BENCH_MODEL || null;
  const lock = (process.env.JEXI_PROVIDER_LOCK || '').trim().toLowerCase() || null;
  const startedAt = new Date().toISOString();
  const runId = `m20-repair-${startedAt.replace(/[:.]/g, '-')}`;

  const { tasks, sha256, dataset } = loadDataset();
  const selected = tasks.slice(0, limit);
  console.log(`[m20-repair] tasks=${selected.length} maxRepairs=${maxRepairs} profile=${toolProfile} model=${model || '(ladder)'} lock=${lock || '(none)'}`);

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'm20-repair-'));
  const rows = [];

  for (const task of selected) {
    const sandboxDir = path.join(tmpRoot, task.task_id.replace('/', '_'));
    materialiseTask(task, sandboxDir);
    const { solutionPath, testName } = taskPaths(task, sandboxDir);

    const attempts = [];
    const runInfo = {};
    let finalPass = false;
    let resolvedByRepair = false;

    const loop = await runBoundedRepair({
      maxRepairs,
      runAttempt: async ({ attempt, ctx }) => {
        const t0 = Date.now();
        const query = attempt === 0
          ? buildQuery(task, solutionPath, testName)
          : buildRepairQuery({
              task, solutionPath, testName,
              currentSolution: fs.existsSync(solutionPath) ? fs.readFileSync(solutionPath, 'utf8') : '',
              gradeOutput: ctx.previousGradeOutput || '',
              attempt,
            });
        let agentInfo = {};
        try {
          agentInfo = await runTaskWithJexi({ task, sandboxDir, schemaMode, toolProfile, timeoutMs: perTaskTimeoutMs, log: () => {}, queryOverride: query });
        } catch (e) {
          agentInfo = { error: String((e && e.message) || e) };
        }
        runInfo[attempt] = {
          durationMs: Date.now() - t0,
          toolCalls: (agentInfo.events || []).filter((e) => e.type === 'tool/call').map((e) => e.data?.name),
          toolResults: (agentInfo.events || []).filter((e) => e.type === 'tool/result').map((e) => ({ name: e.data?.name, ok: !!e.data?.ok })),
        };
        return agentInfo;
      },
      grade: async () => gradeLocally({ sandboxDir, solutionName: 'solution.py', testName, entryPoint: task.entry_point }),
      onAttempt: (rec) => {
        const info = runInfo[rec.attempt] || {};
        attempts.push({
          attempt: rec.attempt,
          pass: rec.pass,
          gradedPass: rec.gradedPass,
          agentTimedOut: rec.agentTimedOut,
          agentError: rec.agentError,
          resolveReason: rec.resolveReason,
          durationMs: info.durationMs || 0,
          toolCalls: info.toolCalls || [],
          toolResults: info.toolResults || [],
          graderRan: rec.graderRan,
          graderVerdict: rec.gradedPass ? 'PASS' : 'FAIL',
          gradeOutputTail: rec.gradeOutput.slice(-600),
        });
      },
    });
    finalPass = loop.finalPass;
    resolvedByRepair = loop.resolvedByRepair;

    const first = attempts[0];
    const row = {
      taskId: task.task_id,
      entryPoint: task.entry_point,
      firstAttemptPass: first.pass,          // == Condition A verdict on the same draw
      finalPass,                             // == Condition B verdict
      resolvedByRepair,
      repairAttempts: attempts.length - 1,
      attempts,
      model,
      providerLock: lock,
    };
    rows.push(row);
    console.log(`  ${finalPass ? 'PASS' : 'FAIL'}  ${task.task_id.padEnd(15)} attempts=${attempts.length} (first=${first.pass ? 'P' : 'F'}${resolvedByRepair ? ' recovered-by-repair' : ''})`);
  }

  const aRows = rows.map((r) => ({ pass: r.firstAttemptPass }));
  const bRows = rows.map((r) => ({ pass: r.finalPass, gradedPass: r.finalPass }));
  const metrics = {
    conditionA: summarise(aRows),
    conditionB: summarise(bRows),
    recoveredByRepair: rows.filter((r) => r.resolvedByRepair).length,
    repairsAttempted: rows.reduce((n, r) => n + r.repairAttempts, 0),
    tasksUsingRepair: rows.filter((r) => r.repairAttempts > 0).length,
    providerLock: lock,
  };

  const manifest = {
    benchmark: 'humaneval', mission: 'M20', condition: 'B (bounded test-driven repair)',
    dataset: { repo: dataset.name, config: dataset.config, split: dataset.split, sha256, numRowsTotal: dataset.num_rows_total },
    leg: 'jexi', schemaMode, toolProfile, maxRepairs,
    model: model || 'provider-ladder (keyless floor: kilo/pollinations)',
    providerLock: lock, modelProviderEnv: process.env.MODEL_PROVIDER || null,
    ollamaHost: process.env.OLLAMA_HOST || null,
    tasks: selected.length, taskIds: selected.map((t) => t.task_id),
    gitCommit: gitRev(), gitDirty: gitDirty(),
    grader: 'local subprocess (NOT isolated)', gradedWithoutIsolation: true,
    node: process.version, platform: `${process.platform}/${process.arch}`,
    startedAt, runId,
  };

  const out = { manifest, conditionA: metrics.conditionA, conditionB: metrics.conditionB, metrics, rows };
  fs.mkdirSync(path.join(HERE, 'results'), { recursive: true });
  const outPath = path.join(HERE, 'results', `${runId}.json`);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  const a = metrics.conditionA.resolvedRate * 100;
  const b = metrics.conditionB.resolvedRate * 100;
  console.log(`\n[m20-repair] A ${metrics.conditionA.resolved}/${metrics.conditionA.total} = ${a.toFixed(1)}%`);
  console.log(`[m20-repair] B ${metrics.conditionB.resolved}/${metrics.conditionB.total} = ${b.toFixed(1)}%`);
  console.log(`[m20-repair] delta = ${(b - a).toFixed(1)} pp · recovered-by-repair=${metrics.recoveredByRepair} · repairsAttempted=${metrics.repairsAttempted}`);
  console.log(`[m20-repair] wrote ${outPath}`);
}

main().then(() => process.exit(0), (e) => { console.error('[m20-repair] FATAL', e); process.exit(1); });

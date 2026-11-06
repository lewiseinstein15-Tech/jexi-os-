/**
 * M23 — CONTRACT-AWARE CODING driver (Conditions B and C).
 *
 * Reuses the REAL agent loop (`runTaskWithJexi`) and the OFFICIAL grader
 * (`gradeLocally`) exactly as `m20-repair.mjs` does. What M23 adds:
 *
 *   Condition B — contract-aware SINGLE PASS. The first (and only) attempt is
 *   handed the extracted function contract as an explicit block, and no repair
 *   runs. This isolates the effect of contract awareness from repair.
 *
 *   Condition C — contract-aware generation + INTELLIGENT diagnosis + the
 *   EXISTING bounded repair (max 2, unchanged). Each repair attempt is preceded
 *   by a diagnosis of the actual failure (class + specific correction hint),
 *   not a bare traceback echo.
 *
 * Safety properties are inherited from `lib/repair.mjs` and `lib/score.mjs`:
 *   - max 2 repairs (MAX_REPAIRS), enforced in the loop — NOT raised;
 *   - the OFFICIAL grader decides every attempt; the model never self-grades;
 *   - timeout / grader error is never a pass;
 *   - the failing-test output handed back is scrubbed of credential shapes;
 *   - the official test file is never modified.
 *
 * Usage:
 *   MODEL_PROVIDER=ollama JEXI_PROVIDER_LOCK=ollama OLLAMA_HOST=http://127.0.0.1:11434 \
 *   BENCH_MODEL=llama3.2:3b node benchmarks/humaneval-live/m23-repair.mjs \
 *     --config C --tasks 15 --timeout 300 --profile full --repairs 2
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { loadDataset, materialiseTask, gradeLocally } from './lib/tasks.mjs';
import { runTaskWithJexi, taskPaths, fsNamesQuery, contractQuery } from './lib/agent.mjs';
import { scoreTask, summarise } from './lib/score.mjs';
import { runBoundedRepair, MAX_REPAIRS } from './lib/repair.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const SERVER = path.join(REPO, 'server');

const { extractFunctionContract, renderContractBlock } = await import(path.join(SERVER, 'src/services/agent/FunctionContract.js'));
const { diagnoseFailure, correctionHint, isRepeatedAttempt } = await import(path.join(SERVER, 'src/services/agent/FailureDiagnosis.js'));

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}
function gitRev() { try { return execFileSync('git', ['-C', REPO, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { return null; } }
function gitDirty() { try { return execFileSync('git', ['-C', REPO, 'status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0; } catch { return null; } }

/** Strip anything credential-shaped from text handed back to the model. */
function scrub(text) {
  return String(text || '')
    .replace(/\b(sk|pk|ghp|gho|xox[baprs])[-_A-Za-z0-9]{12,}/g, '[redacted]')
    .replace(/\b[A-Z0-9_]*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)[A-Z0-9_]*\s*[:=]\s*\S+/gi, '$1=[redacted]')
    .replace(/Authorization:\s*\S+/gi, 'Authorization: [redacted]');
}

/**
 * Build the M23 repair query: contract + DIAGNOSIS + specific correction hint +
 * the real failing-test output + the current file.
 */
function buildDiagnosedRepairQuery({ task, solutionPath, testName, currentSolution, gradeOutput, diagnosis, contract, attempt, repeated, noWrite }) {
  const hint = correctionHint(diagnosis, contract);
  const block = contract ? renderContractBlock(contract) : null;
  return [
    `Your previous attempt to implement the Python function ${task.entry_point} FAILED the official test (repair attempt ${attempt} of ${MAX_REPAIRS}).`,
    '',
    `DIAGNOSIS: this is a "${diagnosis.class}" failure.`,
    `EVIDENCE: ${diagnosis.evidence}`,
    '',
    block ? `${block}\n` : '',
    'WHAT TO DO:',
    /* A no-write attempt needs a different correction from a wrong-code one:
       the file is still the untouched stub, so the fix is to CALL the writer,
       not to change an algorithm that was never written. */
    noWrite ? 'CRITICAL: your previous attempt did NOT write the file at all — the file still holds only the task stub. Do not answer with prose. Your very next action MUST be a single fs_write tool call that writes the complete file.' : '',
    hint,
    repeated ? 'IMPORTANT: your new attempt is IDENTICAL to the previous one. You MUST change the code this time — a resubmission cannot pass.' : '',
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
    `Write the corrected FULL file to ${solutionPath} with the fs_write tool (one call, complete file).`,
    'Do NOT modify the test file — the fix is in the implementation.',
    `Then run ${testName} with the term_execute tool and confirm it passes.`,
  ].filter(Boolean).join('\n');
}

async function main() {
  const config = String(arg('config', 'C')).toUpperCase();
  if (!['B', 'C'].includes(config)) throw new Error(`--config must be B or C (got ${config})`);
  const limit = Number(arg('tasks', '15'));
  const perTaskTimeoutMs = Number(arg('timeout', '300')) * 1000;
  const toolProfile = arg('profile', 'full');
  const schemaMode = arg('schema', 'as-shipped');
  const maxRepairs = config === 'B' ? 0 : Math.min(MAX_REPAIRS, Number(arg('repairs', String(MAX_REPAIRS))));
  const model = process.env.BENCH_MODEL || null;
  const lock = (process.env.JEXI_PROVIDER_LOCK || '').trim().toLowerCase() || null;
  const startedAt = new Date().toISOString();
  const runId = `m23-${config}-${startedAt.replace(/[:.]/g, '-')}`;

  const { tasks, sha256, dataset } = loadDataset();
  const selected = tasks.slice(0, limit);
  console.log(`[m23] config=${config} tasks=${selected.length} maxRepairs=${maxRepairs} profile=${toolProfile} model=${model || '(ladder)'} lock=${lock || '(none)'}`);

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), `m23-${config}-`));
  const rows = [];

  for (const task of selected) {
    const sandboxDir = path.join(tmpRoot, task.task_id.replace('/', '_'));
    materialiseTask(task, sandboxDir);
    const { solutionPath, testName } = taskPaths(task, sandboxDir);

    /* Contract extraction is part of the measured pipeline for B and C. */
    const contract = extractFunctionContract(task.prompt, { entryPoint: task.entry_point });
    const contractExtracted = contract.name === task.entry_point;

    const attempts = [];
    const runInfo = {};
    const priorSources = [];
    let repeatObserved = false;

    const loop = await runBoundedRepair({
      maxRepairs,
      runAttempt: async ({ attempt, ctx }) => {
        const t0 = Date.now();
        const currentSolution = fs.existsSync(solutionPath) ? fs.readFileSync(solutionPath, 'utf8') : '';
        let query;
        if (attempt === 0) {
          query = contractQuery(task, solutionPath, testName, contract);
        } else {
          const d = ctx.diagnosis || diagnoseFailure({ gradeOutput: ctx.previousGradeOutput || '', source: currentSolution, contract });
          /* The file still holding only the task stub means the previous attempt
             never wrote — that is a delivery failure, not a wrong algorithm, and
             it is NOT a "repeat" of real code. */
          const stubText = `${task.prompt}\n`;
          const noWrite = currentSolution.trim().length === 0 || currentSolution.trim() === stubText.trim();
          const repeated = !noWrite && isRepeatedAttempt(currentSolution, priorSources);
          if (repeated) repeatObserved = true;
          query = buildDiagnosedRepairQuery({ task, solutionPath, testName, currentSolution, gradeOutput: ctx.previousGradeOutput || '', diagnosis: d, contract, attempt, repeated, noWrite });
        }
        let agentInfo = {};
        try {
          agentInfo = await runTaskWithJexi({ task, sandboxDir, schemaMode, toolProfile, timeoutMs: perTaskTimeoutMs, log: () => {}, queryOverride: query });
        } catch (e) {
          agentInfo = { error: String((e && e.message) || e) };
        }
        const wrote = fs.existsSync(solutionPath) ? fs.readFileSync(solutionPath, 'utf8') : '';
        priorSources.push(wrote);
        runInfo[attempt] = {
          durationMs: Date.now() - t0,
          toolCalls: (agentInfo.events || []).filter((e) => e.type === 'tool/call').map((e) => e.data?.name),
          toolResults: (agentInfo.events || []).filter((e) => e.type === 'tool/result').map((e) => ({ name: e.data?.name, ok: !!e.data?.ok })),
        };
        return agentInfo;
      },
      grade: async () => gradeLocally({ sandboxDir, solutionName: 'solution.py', testName, entryPoint: task.entry_point }),
      /* Condition C — diagnose the failure and hand the diagnosis to the next
         attempt. Condition B never repairs, so this is only called when a
         repair will follow. */
      makeRepairContext: ({ previousGradeOutput }) => {
        const src = fs.existsSync(solutionPath) ? fs.readFileSync(solutionPath, 'utf8') : null;
        return { diagnosis: diagnoseFailure({ gradeOutput: previousGradeOutput, source: src, contract }) };
      },
      onAttempt: (rec) => {
        const info = runInfo[rec.attempt] || {};
        const src = fs.existsSync(solutionPath) ? fs.readFileSync(solutionPath, 'utf8') : '';
        const stub = `${task.prompt}\n`;
        const wroteSolution = src.trim().length > 0 && src.trim() !== stub.trim();
        const d = rec.pass ? null : diagnoseFailure({ agentError: rec.agentError, gradeOutput: rec.gradeOutput, gradedPass: rec.gradedPass, source: src, contract });
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
          wroteSolution,
          diagnosis: d ? d.class : null,
          diagnosisEvidence: d ? d.evidence : null,
          gradeOutputTail: rec.gradeOutput.slice(-600),
        });
      },
    });

    const first = attempts[0];
    const finalSolution = fs.existsSync(solutionPath) ? fs.readFileSync(solutionPath, 'utf8') : null;
    const row = {
      taskId: task.task_id,
      entryPoint: task.entry_point,
      contractExtracted,
      contractName: contract.name,
      contractSignature: contract.signature,
      firstAttemptPass: first.pass,
      finalPass: loop.finalPass,
      resolvedByRepair: loop.resolvedByRepair,
      repairAttempts: attempts.length - 1,
      repeatedAttemptObserved: repeatObserved,
      attempts,
      finalSolution,
      model,
      providerLock: lock,
    };
    rows.push(row);
    console.log(`  ${loop.finalPass ? 'PASS' : 'FAIL'}  ${task.task_id.padEnd(15)} attempts=${attempts.length} (first=${first.pass ? 'P' : 'F'}${loop.resolvedByRepair ? ' recovered-by-repair' : ''}) diag0=${first.diagnosis || '-'}`);
  }

  const aRows = rows.map((r) => ({ pass: r.firstAttemptPass }));
  const bRows = rows.map((r) => ({ pass: r.finalPass, gradedPass: r.finalPass }));
  const firstPass = rows.filter((r) => r.firstAttemptPass).length;
  const finalPass = rows.filter((r) => r.finalPass).length;
  const metrics = {
    firstPass: summarise(aRows),
    finalPass: summarise(bRows),
    contractExtractionSuccess: rows.filter((r) => r.contractExtracted).length,
    recoveredByRepair: rows.filter((r) => r.resolvedByRepair).length,
    repairsAttempted: rows.reduce((n, r) => n + r.repairAttempts, 0),
    tasksUsingRepair: rows.filter((r) => r.repairAttempts > 0).length,
    repeatedAttemptTasks: rows.filter((r) => r.repeatedAttemptObserved).length,
    diagnosisHistogram: rows.flatMap((r) => r.attempts.map((a) => a.diagnosis)).filter(Boolean)
      .reduce((h, c) => ({ ...h, [c]: (h[c] || 0) + 1 }), {}),
    providerLock: lock,
  };

  const manifest = {
    benchmark: 'humaneval', mission: 'M23', condition: config === 'B' ? 'B (contract-aware single pass)' : 'C (contract-aware + diagnosis + bounded repair)',
    dataset: { repo: dataset.name, config: dataset.config, split: dataset.split, sha256, numRowsTotal: dataset.num_rows_total },
    leg: 'jexi', schemaMode, toolProfile, maxRepairs,
    model: model || 'provider-ladder', providerLock: lock, modelProviderEnv: process.env.MODEL_PROVIDER || null,
    ollamaHost: process.env.OLLAMA_HOST || null,
    tasks: selected.length, taskIds: selected.map((t) => t.task_id),
    promptVariant: 'A', promptLabel: 'current', queryMode: config === 'B' || config === 'C' ? 'contract-aware' : 'fs-names',
    gitCommit: gitRev(), gitDirty: gitDirty(),
    grader: 'local subprocess (NOT isolated)', gradedWithoutIsolation: true,
    node: process.version, platform: `${process.platform}/${process.arch}`,
    startedAt, runId,
  };

  const out = { manifest, firstPass: metrics.firstPass, finalPass: metrics.finalPass, metrics, rows };
  fs.mkdirSync(path.join(HERE, 'results'), { recursive: true });
  const outPath = path.join(HERE, 'results', `${runId}.json`);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\n[m23] config=${config} contractExtraction=${metrics.contractExtractionSuccess}/${rows.length}`);
  console.log(`[m23] first-pass ${firstPass}/${rows.length} = ${(100 * firstPass / rows.length).toFixed(1)}%`);
  console.log(`[m23] final     ${finalPass}/${rows.length} = ${(100 * finalPass / rows.length).toFixed(1)}%`);
  if (config === 'C') console.log(`[m23] recovered-by-repair=${metrics.recoveredByRepair} · repairsAttempted=${metrics.repairsAttempted} · repeatedAttemptTasks=${metrics.repeatedAttemptTasks}`);
  console.log(`[m23] diagnosis histogram: ${JSON.stringify(metrics.diagnosisHistogram)}`);
  console.log(`[m23] wrote ${outPath}`);
}

main().then(() => process.exit(0), (e) => { console.error('[m23] FATAL', e); process.exit(1); });

/**
 * M20 — VERIFIED CODING CAPABILITY: full-slice capture driver.
 *
 * Runs the REAL agent loop (lib/agent.mjs → server/src/services/AgentLoop.js)
 * over a HumanEval slice and records, per task, EVERY signal the M20 mission
 * asks for: the exact model/provider, the offered menu, native vs recovered vs
 * alias-resolved tool calls, payload normalization, tool-execution results,
 * the file left on disk, the OFFICIAL grader's verdict, and the reconciled
 * completion-gate verdict.
 *
 * It reuses the shipped grader (`gradeLocally`) and the shipped reconciliation
 * (`scoreTask`) so neither the grader nor the completion gate is altered here.
 * Every run writes a NEW results/ artifact; nothing is overwritten.
 *
 * Usage:
 *   MODEL_PROVIDER=ollama JEXI_PROVIDER_LOCK=ollama OLLAMA_HOST=http://127.0.0.1:11434 \
 *   BENCH_MODEL=llama3.2:3b MODEL_NAME=llama3.2:3b OLLAMA_MODEL=llama3.2:3b \
 *   node benchmarks/humaneval-live/m20-capture.mjs --tasks 15 --timeout 300 --profile full
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { loadDataset, materialiseTask, gradeLocally } from './lib/tasks.mjs';
import { runTaskWithJexi } from './lib/agent.mjs';
import { scoreTask, summarise } from './lib/score.mjs';

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

/** Pull the audit signals out of the raw event stream. */
function extractSignals(events) {
  const planEvent = events.find((e) => e.type === 'agent.plan');
  const offeredTools = planEvent ? (planEvent.data?.tools || []).map((t) => t.slug || t.name) : null;
  const toolCalls = events.filter((e) => e.type === 'tool/call').map((e) => ({ name: e.data?.name, recovery: e.data?.recovery || null }));
  const recovered = events.filter((e) => e.type === 'tool/recovered').map((e) => ({ name: e.data?.name, aliasedFrom: e.data?.aliasedFrom || null, path: e.data?.path || null }));
  const normalized = events.filter((e) => e.type === 'tool.payload_normalized').map((e) => ({ tool: e.data?.tool, reason: e.data?.reason, stats: e.data?.stats || null }));
  const toolResults = events.filter((e) => e.type === 'tool/result').map((e) => ({ name: e.data?.name, ok: !!e.data?.ok, error: e.data?.error || null }));
  const logs = events.filter((e) => e.type === 'agent.log').map((e) => String(e.data?.message || ''));
  const malformedRetry = logs.some((m) => m.includes('unparseable arguments'));
  const doneEvent = events.find((e) => e.type === 'agent.done');
  const jexiGate = doneEvent ? (doneEvent.data?.verification || null) : null;
  const nativeCalls = toolCalls.filter((c) => !c.recovery).length;
  const aliasResolved = recovered.filter((r) => r.aliasedFrom).length;
  return { offeredTools, toolCalls, recovered, normalized, toolResults, malformedRetry, nativeCalls, aliasResolved, logs, jexiGate };
}

function listWritten(sandboxDir) {
  try {
    return fs.readdirSync(sandboxDir).filter((f) => f.endsWith('.py') && f !== 'grade.py');
  } catch { return []; }
}

async function main() {
  const limit = Number(arg('tasks', '15'));
  const perTaskTimeoutMs = Number(arg('timeout', '300')) * 1000;
  const toolProfile = arg('profile', 'full');
  const schemaMode = arg('schema', 'as-shipped');
  const model = process.env.BENCH_MODEL || null;
  const lock = (process.env.JEXI_PROVIDER_LOCK || '').trim().toLowerCase() || null;
  const startedAt = new Date().toISOString();
  const runId = `m20-qualification-${startedAt.replace(/[:.]/g, '-')}`;

  const { tasks, sha256, dataset } = loadDataset();
  const selected = tasks.slice(0, limit);
  console.log(`[m20] tasks=${selected.length} profile=${toolProfile} schema=${schemaMode} model=${model || '(ladder)'} lock=${lock || '(none)'}`);
  console.log(`[m20] dataset sha256=${sha256}`);

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'm20-live-'));
  const rows = [];

  for (const task of selected) {
    const sandboxDir = path.join(tmpRoot, task.task_id.replace('/', '_'));
    materialiseTask(task, sandboxDir);
    const testName = `test_${task.entry_point}.py`;
    const t0 = Date.now();

    let agentInfo = {};
    try {
      agentInfo = await runTaskWithJexi({ task, sandboxDir, schemaMode, toolProfile, timeoutMs: perTaskTimeoutMs, log: () => {} });
    } catch (e) {
      agentInfo = { error: String((e && e.message) || e) };
    }

    const graded = gradeLocally({ sandboxDir, solutionName: 'solution.py', testName, entryPoint: task.entry_point });
    const scored = scoreTask({ graded, agentError: agentInfo.error || null });
    const durationMs = Date.now() - t0;

    const sig = extractSignals(agentInfo.events || []);
    const solution = agentInfo.solution || '';
    const literalNewlines = (solution.match(/\\n/g) || []).length;
    const realNewlines = (solution.match(/\n/g) || []).length;
    const wroteSolution = fs.existsSync(path.join(sandboxDir, 'solution.py'));
    const gradeOutput = String(graded.output || '');

    const row = {
      taskId: task.task_id,
      entryPoint: task.entry_point,
      pass: scored.pass,
      gradedPass: scored.gradedPass,
      agentTimedOut: scored.agentTimedOut,
      resolveReason: scored.reason,
      durationMs,
      model,
      providerLock: lock,
      providersThatServed: agentInfo.providersThatServed || null,
      providerAttempts: (agentInfo.providerAttempts || []).map((a) => ({ provider: a.provider, model: a.model, ok: a.ok, ms: a.ms, lane: a.lane })),
      offeredTools: sig.offeredTools,
      toolCalls: sig.toolCalls,
      nativeCalls: sig.nativeCalls,
      recoveredCalls: sig.recovered,
      aliasResolved: sig.aliasResolved,
      payloadNormalized: sig.normalized,
      malformedRetry: sig.malformedRetry,
      toolResults: sig.toolResults,
      filesWritten: listWritten(sandboxDir),
      wroteSolution,
      solutionHead: solution.slice(0, 400),
      literalNewlines,
      realNewlines,
      graderRan: graded.error == null,
      graderExitCode: graded.exitCode ?? null,
      graderVerdict: graded.passed ? 'PASS' : 'FAIL',
      gradeOutputTail: gradeOutput.slice(-600),
      completionGate: { status: scored.pass ? 'resolved' : 'unresolved', reason: scored.reason },
      jexiVerification: sig.jexiGate,
      agentError: agentInfo.error || null,
      stats: agentInfo.stats || null,
      recoveryLogs: sig.logs.filter((m) => /recovered|unparseable|verification/i.test(m)).slice(0, 6),
    };
    rows.push(row);
    console.log(`  ${row.pass ? 'PASS' : (row.gradedPass ? 'GREEN-UNRESOLVED' : 'FAIL')}  ${task.task_id.padEnd(15)} ${String(durationMs).padStart(7)}ms native=${row.nativeCalls} recovered=${row.recoveredCalls.length} alias=${row.aliasResolved} norm=${row.payloadNormalized.length} tools=${row.toolCalls.length}${row.agentError ? ' err=' + row.agentError.slice(0, 40) : ''}`);
  }

  const metrics = summarise(rows);
  metrics.providerLock = lock;
  metrics.ladderSlid = lock ? rows.filter((r) => (r.providersThatServed || []).some((p) => p !== lock)).length : null;
  metrics.providersObserved = [...new Set(rows.flatMap((r) => r.providersThatServed || []))];
  metrics.validToolCallTasks = rows.filter((r) => r.toolCalls.length > 0).length;
  metrics.toolExecutedTasks = rows.filter((r) => r.toolResults.some((t) => t.ok)).length;
  metrics.parseableCodeTasks = rows.filter((r) => r.graderRan && !/SyntaxError/.test(r.gradeOutputTail)).length;
  metrics.syntaxErrorTasks = rows.filter((r) => /SyntaxError/.test(r.gradeOutputTail)).length;

  const manifest = {
    benchmark: 'humaneval',
    mission: 'M20',
    dataset: { repo: dataset.name, config: dataset.config, split: dataset.split, sha256, numRowsTotal: dataset.num_rows_total },
    leg: 'jexi',
    schemaMode,
    toolProfile,
    model: model || 'provider-ladder (keyless floor: kilo/pollinations)',
    providerLock: lock,
    modelProviderEnv: process.env.MODEL_PROVIDER || null,
    ollamaHost: process.env.OLLAMA_HOST || null,
    tasks: selected.length,
    taskIds: selected.map((t) => t.task_id),
    gitCommit: gitRev(),
    gitDirty: gitDirty(),
    grader: 'local subprocess (NOT isolated)',
    gradedWithoutIsolation: true,
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    startedAt,
    runId,
  };

  const out = { manifest, resolved: metrics.resolved, passed: metrics.resolved, failed: rows.length - metrics.resolved, metrics, rows };
  fs.mkdirSync(path.join(HERE, 'results'), { recursive: true });
  const outPath = path.join(HERE, 'results', `${runId}.json`);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\n[m20] resolved ${metrics.resolved}/${rows.length} = ${(metrics.resolvedRate * 100).toFixed(1)}%`);
  console.log(`[m20] gradedGreen=${metrics.gradedGreen} timeouts=${metrics.timeouts} syntaxErrors=${metrics.syntaxErrorTasks} validToolCallTasks=${metrics.validToolCallTasks} ladderSlid=${metrics.ladderSlid}`);
  console.log(`[m20] wrote ${outPath}`);
}

main().then(() => process.exit(0), (e) => { console.error('[m20] FATAL', e); process.exit(1); });

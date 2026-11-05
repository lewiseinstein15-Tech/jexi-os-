/**
 * M21 — EXECUTION STRATEGY PROBE.
 *
 * Runs the REAL agent loop (lib/agent.mjs → server/src/services/AgentLoop.js)
 * over the same HumanEval slice the M20 baseline used, but with a controlled
 * change to ONE variable per run, so the effect of that variable is isolated:
 *
 *   --prompt  A   current JEXI system prompt (no override — the M20 baseline)
 *   --prompt  B   compact prompt (identity + rules + tools + completion only)
 *   --prompt  C   coding-focused prompt (understand → select tools → write →
 *                 run → test → verify workflow)
 *   --prompt  D   structured execution checklist
 *   --query   as-is | fs-names
 *                 fs-names rewrites the task query to name the tools that are
 *                 ACTUALLY in the offered menu (fs_write / term_execute) instead
 *                 of the legacy `code-write` / `code-run` the default query uses.
 *
 * Nothing here alters the grader, the completion gate, the tool menu, the
 * sandbox or the provider ladder. It only changes the prompt text handed to
 * the model (via the loop's documented `systemPromptOverride` seam) and/or the
 * user query (via `queryOverride`). Every run writes a NEW results artifact.
 *
 * Usage:
 *   MODEL_PROVIDER=ollama JEXI_PROVIDER_LOCK=ollama OLLAMA_HOST=http://127.0.0.1:11434 \
 *   BENCH_MODEL=llama3.2:3b MODEL_NAME=llama3.2:3b OLLAMA_MODEL=llama3.2:3b \
 *   node benchmarks/humaneval-live/m21-probe.mjs --tasks 15 --timeout 300 \
 *     --profile full --schema as-shipped --prompt B --query as-is
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { loadDataset, materialiseTask, gradeLocally } from './lib/tasks.mjs';
import { runTaskWithJexi, buildQuery, taskPaths } from './lib/agent.mjs';
import { scoreTask, summarise } from './lib/score.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const SERVER = path.join(REPO, 'server');

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}
function gitRev() { try { return execFileSync('git', ['-C', REPO, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { return null; } }
function gitDirty() { try { return execFileSync('git', ['-C', REPO, 'status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0; } catch { return null; } }

/* ------------------------------------------------------------------ prompts */

const COMPACT_PROMPT = `# IDENTITY
You are JEXI OS, an autonomous coding agent. You complete coding tasks by
WRITING FILES and RUNNING COMMANDS with your tools — not by describing code.

# RULES
1. Do the work with tools. Never answer a coding task with code in prose.
2. Write the complete file to the exact path you were given.
3. Run the test. If it fails, read the error, fix the file, run again.
4. Never claim success you have not verified by running the test.
5. Do not modify the test file. Do not invent sources or results.`;

const CODING_PROMPT = `# IDENTITY
You are JEXI OS, a coding agent operating in a sandbox. You work in a strict loop:
understand → choose tools → write → execute → test → verify.

# HOW TO CALL A TOOL (critical)
You MUST act by emitting a real TOOL CALL — the structured function call your
API exposes. Do NOT type the code into your reply. Do NOT write shell commands
as text (never write "fs_write path ..." or "term_execute ..." in prose).
A reply that contains only code or only text is a FAILURE: nothing is written.

# CODING WORKFLOW (follow in order)
1. UNDERSTAND the task: read the prompt and the required function signature.
2. CALL THE TOOL: emit a tool call to fs_write (to create/change a file) or to
   term_execute (to run a command). Use those exact tool names.
3. WRITE the COMPLETE, self-contained implementation to the exact file path
   given, with every needed import. Never write partial code.
4. CALL term_execute to run the test file and see the real result.
5. READ the real output. If it fails, form a new hypothesis and fix the file.
6. VERIFY: only after the test passes may you say the task is done. If it never
   passes, report exactly what is still failing.

# RULES
- A coding task is finished ONLY when the file exists AND its test passes.
- Never put code in your reply instead of calling a tool. Never modify the test file.
- Do not repeat an edit that already failed — change your approach.`;

const CHECKLIST_PROMPT = `# IDENTITY
You are JEXI OS, a coding agent. Complete the task with tools, step by step.

# HOW TO CALL A TOOL (critical)
Emit a real TOOL CALL. Do NOT write code or shell commands as text in your
reply — text-only replies write nothing and fail the task.

# EXECUTION CHECKLIST — do each step, in order
[ ] 1. Identify the exact file path I must write and the function I must define.
[ ] 2. Emit a tool call to fs_write to create that file.
[ ] 3. In that same fs_write call, write the COMPLETE file — all imports and
       the full function body. Never partial code.
[ ] 4. Emit a tool call to term_execute to run the test file.
[ ] 5. Read the test output. If it failed, fix the file with fs_write and run
       the test again with term_execute.
[ ] 6. Stop only when the test passes; otherwise report what still fails.

# RULES
- Do not reply with the code as text — emit a tool call that writes it.
- Do not claim success before the test passes. Do not modify the test file.`;

const PROMPT_VARIANTS = {
  A: { label: 'current', text: null },              // null → the shipped JEXI prompt
  B: { label: 'compact', text: COMPACT_PROMPT },
  C: { label: 'coding-focused', text: CODING_PROMPT },
  D: { label: 'checklist', text: CHECKLIST_PROMPT },
};

/* --------------------------------------------------------------- query mode */

/** fs-names: name the tools that are actually in the offered menu. */
function fsNamesQuery(task, solutionPath, testName) {
  return [
    `Write the complete implementation of the Python function below to the file ${solutionPath}.`,
    '',
    '```python',
    task.prompt.trim(),
    '```',
    '',
    `Use the fs_write tool to write the complete file to ${solutionPath}. Do not reply with the code`,
    'as text — the file on disk is what is graded.',
    `Keep the exact function name (${task.entry_point}) and signature. Put any imports you need at the top of the file.`,
    `The finished file must define ${task.entry_point} and be valid, self-contained Python.`,
    `A test file, ${testName}, is already in the same directory. Use the term_execute tool to run it and confirm it passes. Do not modify the test file.`,
  ].join('\n');
}

/* ------------------------------------------------------------------ signals */

function extractSignals(events) {
  const planEvent = events.find((e) => e.type === 'agent.plan');
  const offeredTools = planEvent ? (planEvent.data?.tools || []).map((t) => t.slug || t.name) : null;
  const toolCalls = events.filter((e) => e.type === 'tool/call').map((e) => ({ name: e.data?.name, recovery: e.data?.recovery || null }));
  const recovered = events.filter((e) => e.type === 'tool/recovered').map((e) => ({ name: e.data?.name, aliasedFrom: e.data?.aliasedFrom || null, path: e.data?.path || null }));
  const normalized = events.filter((e) => e.type === 'tool.payload_normalized').map((e) => ({ tool: e.data?.tool, reason: e.data?.reason }));
  const toolResults = events.filter((e) => e.type === 'tool/result').map((e) => ({ name: e.data?.name, ok: !!e.data?.ok, error: e.data?.error || null }));
  const logs = events.filter((e) => e.type === 'agent.log').map((e) => String(e.data?.message || ''));
  const doneEvent = events.find((e) => e.type === 'agent.done');
  const jexiGate = doneEvent ? (doneEvent.data?.verification || null) : null;
  const answer = doneEvent ? String(doneEvent.data?.answer || '') : '';
  const iterations = doneEvent?.data?.stats?.iterations ?? null;
  const nativeCalls = toolCalls.filter((c) => !c.recovery).length;
  const aliasResolved = recovered.filter((r) => r.aliasedFrom).length;
  const malformedRetry = logs.some((m) => m.includes('unparseable arguments'));
  /* Phase 2 diagnosis — the model's own final text is the primary evidence for
     "did it understand the task?" and "did it write code as prose instead of
     calling a tool?". Captured verbatim (head + tail), never summarised. */
  const answerHead = answer.slice(0, 700);
  const answerTail = answer.slice(-400);
  const answerHasCodeBlock = /```/.test(answer);
  const answerLooksLikeCall = /\{\s*"(name|tool|function|parameters|arguments)"/.test(answer);
  return { offeredTools, toolCalls, recovered, normalized, toolResults, malformedRetry, nativeCalls, aliasResolved, logs, jexiGate, answer, answerHead, answerTail, answerHasCodeBlock, answerLooksLikeCall, iterations };
}

function listWritten(sandboxDir) {
  try { return fs.readdirSync(sandboxDir).filter((f) => f.endsWith('.py') && f !== 'grade.py'); } catch { return []; }
}

/** Estimate the assembled system prompt for this variant (chars + rough tokens). */
async function measurePrompt(variantText, query) {
  try {
    const { assemblePrompt } = await import(path.join(SERVER, 'src/services/PromptAssembly.js'));
    const text = await assemblePrompt({ base: variantText || null, userText: query });
    return { chars: text.length, estTokens: Math.round(text.length / 4) };
  } catch (e) {
    return { error: String((e && e.message) || e) };
  }
}

/* --------------------------------------------------------------------- main */

async function main() {
  const limit = Number(arg('tasks', '15'));
  const perTaskTimeoutMs = Number(arg('timeout', '300')) * 1000;
  const toolProfile = arg('profile', 'full');
  const schemaMode = arg('schema', 'as-shipped');
  const promptKey = String(arg('prompt', 'A')).toUpperCase();
  const queryMode = String(arg('query', 'as-is'));
  const variant = PROMPT_VARIANTS[promptKey];
  if (!variant) throw new Error(`unknown --prompt ${promptKey} (A|B|C|D)`);
  const model = process.env.BENCH_MODEL || null;
  const lock = (process.env.JEXI_PROVIDER_LOCK || '').trim().toLowerCase() || null;
  const startedAt = new Date().toISOString();
  const runId = `m21-probe-${promptKey}-${queryMode}-${startedAt.replace(/[:.]/g, '-')}`;

  const { tasks, sha256, dataset } = loadDataset();
  const selected = tasks.slice(0, limit);
  console.log(`[m21] prompt=${promptKey}(${variant.label}) query=${queryMode} tasks=${selected.length} profile=${toolProfile} schema=${schemaMode} model=${model || '(ladder)'} lock=${lock || '(none)'}`);
  console.log(`[m21] dataset sha256=${sha256}`);

  // Measure the prompt once, for the report (the loop assembles it per task).
  const probeQuery = buildQuery(selected[0], '/sandbox/solution.py', `test_${selected[0].entry_point}.py`);
  const promptStats = await measurePrompt(variant.text, probeQuery);
  console.log(`[m21] assembled system prompt: ${promptStats.chars} chars (~${promptStats.estTokens} tokens)${promptStats.error ? ' ERROR ' + promptStats.error : ''}`);

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'm21-probe-'));
  const rows = [];

  for (const task of selected) {
    const sandboxDir = path.join(tmpRoot, task.task_id.replace('/', '_'));
    materialiseTask(task, sandboxDir);
    const { solutionPath, testName } = taskPaths(task, sandboxDir);
    const queryOverride = queryMode === 'fs-names' ? fsNamesQuery(task, solutionPath, testName) : null;
    const t0 = Date.now();

    let agentInfo = {};
    try {
      agentInfo = await runTaskWithJexi({
        task, sandboxDir, schemaMode, toolProfile, timeoutMs: perTaskTimeoutMs, log: () => {},
        queryOverride,
      });
    } catch (e) {
      agentInfo = { error: String((e && e.message) || e) };
    }

    const graded = gradeLocally({ sandboxDir, solutionName: 'solution.py', testName, entryPoint: task.entry_point });
    const scored = scoreTask({ graded, agentError: agentInfo.error || null });
    const durationMs = Date.now() - t0;
    const sig = extractSignals(agentInfo.events || []);
    const solution = agentInfo.solution || '';
    /* M22/WS5 — stash the full artefacts on the task object for the transcript
       written at the end. The row table keeps only head/tail; this keeps the
       whole thing. Underscored so it is never mistaken for task metadata. */
    task.__answer = sig.answer;
    task.__solution = solution;
    task.__events = agentInfo.events || [];
    /* materialiseTask seeds solution.py with the bare prompt stub, so the file
       always exists. A REAL write is one whose content differs from that stub —
       otherwise a zero-tool-call turn would look like it wrote a solution. */
    const stub = `${task.prompt}\n`;
    const wroteSolution = solution.trim().length > 0 && solution.trim() !== stub.trim();
    const gradeOutput = String(graded.output || '');
    const proseInsteadOfCall = sig.toolCalls.length === 0 && !wroteSolution;

    rows.push({
      taskId: task.task_id,
      entryPoint: task.entry_point,
      pass: scored.pass,
      gradedPass: scored.gradedPass,
      agentTimedOut: scored.agentTimedOut,
      resolveReason: scored.reason,
      durationMs,
      model,
      providerLock: lock,
      promptVariant: promptKey,
      promptLabel: variant.label,
      queryMode,
      offeredTools: sig.offeredTools,
      toolCalls: sig.toolCalls,
      nativeCalls: sig.nativeCalls,
      recoveredCalls: sig.recovered,
      aliasResolved: sig.aliasResolved,
      payloadNormalized: sig.normalized,
      malformedRetry: sig.malformedRetry,
      toolResults: sig.toolResults,
      wroteSolution,
      proseInsteadOfCall,
      answerHead: sig.answerHead,
      answerTail: sig.answerTail,
      answerHasCodeBlock: sig.answerHasCodeBlock,
      answerLooksLikeCall: sig.answerLooksLikeCall,
      iterations: sig.iterations,
      solutionHead: solution.slice(0, 400),
      graderRan: graded.error == null,
      graderVerdict: graded.passed ? 'PASS' : 'FAIL',
      gradeOutputTail: gradeOutput.slice(-600),
      jexiVerification: sig.jexiGate,
      agentError: agentInfo.error || null,
      stats: agentInfo.stats || null,
    });
    const r = rows[rows.length - 1];
    console.log(`  ${r.pass ? 'PASS' : (r.gradedPass ? 'GREEN-UNRESOLVED' : 'FAIL')}  ${task.task_id.padEnd(15)} ${String(durationMs).padStart(7)}ms native=${r.nativeCalls} recovered=${r.recoveredCalls.length} alias=${r.aliasResolved} tools=${r.toolCalls.length} wrote=${r.wroteSolution}${r.agentError ? ' err=' + r.agentError.slice(0, 30) : ''}`);
  }

  const metrics = summarise(rows);
  metrics.providerLock = lock;
  metrics.ladderSlid = lock ? rows.filter((r) => (r.providersThatServed || []).some((p) => p !== lock)).length : null;
  metrics.validToolCallTasks = rows.filter((r) => r.toolCalls.length > 0).length;
  metrics.toolExecutedTasks = rows.filter((r) => r.toolResults.some((t) => t.ok)).length;
  metrics.parseableCodeTasks = rows.filter((r) => r.graderRan && !/SyntaxError/.test(r.gradeOutputTail)).length;
  metrics.syntaxErrorTasks = rows.filter((r) => /SyntaxError/.test(r.gradeOutputTail)).length;
  metrics.wroteSolutionTasks = rows.filter((r) => r.wroteSolution).length;
  metrics.proseInsteadOfCallTasks = rows.filter((r) => r.proseInsteadOfCall).length;
  metrics.promptStats = promptStats;

  const manifest = {
    benchmark: 'humaneval',
    mission: 'M21',
    dataset: { repo: dataset.name, config: dataset.config, split: dataset.split, sha256, numRowsTotal: dataset.num_rows_total },
    leg: 'jexi',
    promptVariant: promptKey,
    promptLabel: variant.label,
    queryMode,
    schemaMode,
    toolProfile,
    model: model || 'provider-ladder',
    providerLock: lock,
    modelProviderEnv: process.env.MODEL_PROVIDER || null,
    ollamaHost: process.env.OLLAMA_HOST || null,
    tasks: selected.length,
    taskIds: selected.map((t) => t.task_id),
    gitCommit: gitRev(),
    gitDirty: gitDirty(),
    grader: 'local subprocess (NOT isolated)',
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    startedAt,
    runId,
  };

  const out = { manifest, resolved: metrics.resolved, passed: metrics.resolved, failed: rows.length - metrics.resolved, metrics, rows };
  fs.mkdirSync(path.join(HERE, 'results'), { recursive: true });
  const outPath = path.join(HERE, 'results', `${runId}.json`);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));

  /* M22/WS5 — PRESERVE THE FULL ANSWERS AND EVENTS.
     The row table above stores only `answerHead`/`answerTail`, so the middle of
     a long answer — the actual generated code — was thrown away, and no raw
     event stream survived at all. Diagnosing "why did this task fail" then
     needed a re-run, and a re-run is ~3 minutes per task of a stochastic
     model, so the evidence could not be recovered. Write a sibling transcript
     holding the COMPLETE answer, the COMPLETE solution bytes, and the COMPLETE
     event list for every task, keyed by task id. It is large on purpose; it is
     the only copy of what the model actually said. */
  const transcript = {
    runId,
    manifest: { ...manifest, tasks: selected.length },
    tasks: rows.map((row) => {
      const t = selected.find((x) => x.task_id === row.taskId) || {};
      return {
        taskId: row.taskId,
        entryPoint: row.entryPoint,
        pass: row.pass,
        gradedPass: row.gradedPass,
        resolveReason: row.resolveReason,
        solution: t.__solution ?? null,
        answer: t.__answer ?? null,
        events: t.__events ?? null,
      };
    }),
  };
  const txPath = path.join(HERE, 'results', `${runId}.transcript.json`);
  fs.writeFileSync(txPath, JSON.stringify(transcript, null, 2));

  console.log(`\n[m21] prompt=${promptKey} query=${queryMode} resolved ${metrics.resolved}/${rows.length} = ${(metrics.resolvedRate * 100).toFixed(1)}%`);
  console.log(`[m21] wrote=${metrics.wroteSolutionTasks} validToolCallTasks=${metrics.validToolCallTasks} toolExecuted=${metrics.toolExecutedTasks} timeouts=${metrics.timeouts} syntaxErrors=${metrics.syntaxErrorTasks} proseOnly=${metrics.proseInsteadOfCallTasks}`);
  console.log(`[m21] wrote ${outPath}`);
  console.log(`[m21] transcript ${txPath}`);
}

main().then(() => process.exit(0), (e) => { console.error('[m21] FATAL', e); process.exit(1); });

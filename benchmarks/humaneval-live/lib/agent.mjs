/**
 * JEXI OS — benchmarks/humaneval-live/lib/agent.mjs
 *
 * Drives JEXI's REAL agent loop (server/src/services/AgentLoop.js) against a
 * materialised HumanEval sandbox. No injected answers: the loop runs the
 * live model through the provider ladder, executes the tool calls the model
 * declares through the real gated ToolRuntime, and the graded artifact is the
 * file left on disk.
 *
 * Two configurations are measured, because JEXI currently advertises domain
 * tools with EMPTY parameter schemas (see ../README.md, "Known finding"):
 *
 *   as-shipped  — the loop is handed exactly what it builds today.
 *   documented  — the system prompt additionally states each offered tool's
 *                 real parameters, so the model is not guessing at an
 *                 interface JEXI failed to describe.
 *
 * Both are reported. The delta between them isolates "the agent cannot code"
 * from "the agent was never told how to call its tools".
 */

import fs from 'node:fs';
import path from 'node:path';

const SERVER = '/workspace/project/jexi-os-/server';

/* M23 — the contract extractor lives in the server tree. It is imported lazily
   and defensively so this benchmark lib still runs if the server module is
   unavailable; `contractQuery` then degrades to `fsNamesQuery`. */
let contractApi = null;
try {
  contractApi = await import(path.join(SERVER, 'src/services/agent/FunctionContract.js'));
} catch {
  contractApi = null;
}

const TOOL_DOC = `You work in a sandbox directory. Two tools are available:

1. fs_write — write a file.
   arguments: {"path": "<absolute or relative path>", "content": "<full file text>"}
2. term_execute — run a shell command and read its output.
   arguments: {"command": "<shell command>"}

Call a tool by emitting a native tool call. Arguments MUST be a JSON object
with exactly the keys listed above.`;

/**
 * The task prompt. The function to complete is given INLINE, exactly as the
 * upstream HumanEval prompt presents it — the agent is not asked to go
 * hunting through files to discover what it is being asked to do. The test
 * file is named once, as a verification aid, not as the subject of the task.
 */
export function buildQuery(task, solutionPath, testName) {
  return [
    `Complete this Python function by writing the full implementation to the file ${solutionPath}.`,
    '',
    '```python',
    task.prompt.trim(),
    '```',
    '',
    `Use the code-write tool to write the complete file to ${solutionPath}. Do not reply with the code`,
    'as text — the file on disk is what is graded.',
    `Keep the exact function name (${task.entry_point}) and signature. Put any imports you need at the top of the file.`,
    `The finished file must define ${task.entry_point} and be valid, self-contained Python.`,
    `A test file, ${testName}, is already in the same directory. Use the code-run tool to run it and confirm it passes. Do not modify the test file.`,
  ].join('\n');
}

/** The solution/test paths for a task inside its sandbox. */
export function taskPaths(task, sandboxDir) {
  return {
    solutionPath: path.join(sandboxDir, 'solution.py'),
    testName: `test_${task.entry_point}.py`,
  };
}

/* M22 — the `fs-names` query used by the M21/M22 probe: it names the tools that
   are actually in the offered menu, instead of the generic "code-write" phrasing
   the model cannot map to a slug. Shared so the bounded-repair leg runs the
   IDENTICAL first-attempt prompt as the no-repair leg (paired comparison). */
export function fsNamesQuery(task, solutionPath, testName) {
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

/* M23 Workstream A/B — the contract-aware query. Same shape as `fsNamesQuery`
   but it renders the EXTRACTED CONTRACT (name, ordered parameters, return,
   behaviour, worked examples) as an explicit, checkable block, so the model is
   not asked to re-derive the interface from a docstring. `contract` is optional
   — when extraction fails the query degrades to `fsNamesQuery` rather than
   inventing an interface. */
export function contractQuery(task, solutionPath, testName, contract = null) {
  const block = contract && contractApi ? contractApi.renderContractBlock(contract) : null;
  const base = fsNamesQuery(task, solutionPath, testName);
  if (!block) return base;
  return [
    `Write the complete implementation of the Python function below to the file ${solutionPath}.`,
    '',
    '```python',
    task.prompt.trim(),
    '```',
    '',
    block,
    '',
    `Use the fs_write tool to write the complete file to ${solutionPath}. Do not reply with the code`,
    'as text — the file on disk is what is graded.',
    `Put any imports you need at the top of the file. The finished file must be valid, self-contained Python.`,
    `A test file, ${testName}, is already in the same directory. Use the term_execute tool to run it and confirm it passes. Do not modify the test file.`,
  ].join('\n');
}

/**
 * Run one task through JEXI's real agent loop.
 * Returns { solution, transcript, stats, events, error, offeredTools }.
 */
export async function runTaskWithJexi({ task, sandboxDir, schemaMode = 'documented', toolProfile = null, maxIterations = null, timeoutMs = 300_000, log = () => {}, queryOverride = null }) {
  const { solutionName, testName } = { solutionName: 'solution.py', testName: `test_${task.entry_point}.py` };
  const solutionPath = path.join(sandboxDir, solutionName);

  // Pin the tool workspace to THIS sandbox so writes cannot leak elsewhere.
  const prevWorkspace = process.env.WORKSPACE_DIR;
  process.env.WORKSPACE_DIR = sandboxDir;

  // M17/D2 — reset the provider audit trail so this task's entries are its own.
  let attemptsApi = null;
  try { attemptsApi = await import(path.join(SERVER, 'src/providers/runtime/ProviderAttempts.js')); attemptsApi.resetProviderAttempts(); } catch { /* optional */ }

  const events = [];
  const sendEvent = (type, data) => { events.push({ type, data }); };
  const query = queryOverride || buildQuery(task, solutionPath, testName);

  const systemDoc = schemaMode === 'documented' ? TOOL_DOC : '';

  if (schemaMode === 'repaired') {
    const { patchDomainSchemas } = await import('./schema-patch.mjs');
    await patchDomainSchemas();
  }

  // Second gate: `code-write` / `code-run` are classified `risky`, and the
  // default `auto` profile blocks risky tools ("Run Code needs risky
  // permission (profile: auto)"). JEXI ships a `coding` profile built for
  // exactly this workload — sandboxed edits and test runs auto-approved,
  // host-destructive tools still gated. Selecting it is configuration, not an
  // architecture change, and it is recorded in the manifest.
  if (toolProfile) {
    const { setToolProfile } = await import(path.join(SERVER, 'src/services/ToolRuntime.js'));
    setToolProfile(toolProfile);
  }

  let result = null;
  let error = null;
  try {
    const { runAgentLoop } = await import(path.join(SERVER, 'src/services/AgentLoop.js'));
    /* M22 — STRUCTURED VERIFY DECLARATION. The harness KNOWS this project's
       shape (flat sandbox, `solution.py`, an exec-style test file), so it
       declares the verification layers and the target function instead of
       leaving the loop to guess `pytest` and report `unverifiable`. This is the
       same class of configuration as `toolProfile` above and is recorded in the
       manifest. Set BENCH_VERIFY_LAYERS="" to fall back to auto-detection. */
    /* `emitFullToolArgs` keeps the whole `fs_write` payload on the tool/call
       event so the transcript holds the bytes the model actually wrote; the
       default 500-char cap cut the code out of every recorded run. */
    const opts = { root: sandboxDir, entryPoint: task.entry_point, emitFullToolArgs: true };
    const declared = process.env.BENCH_VERIFY_LAYERS;
    if (declared !== '') {
      const { parseVerifyLayers } = await import(path.join(SERVER, 'src/services/agent/verify-config.js'));
      const layers = parseVerifyLayers(declared || 'syntax,unit');
      if (layers) opts.verifyLayers = layers;
    }
    if (systemDoc) opts.systemPromptOverride = systemDoc;
    result = await withTimeout(
      runAgentLoop({ query, sendEvent, opts }),
      timeoutMs,
    );
  } catch (e) {
    error = String((e && e.message) || e);
  } finally {
    if (prevWorkspace === undefined) delete process.env.WORKSPACE_DIR;
    else process.env.WORKSPACE_DIR = prevWorkspace;
  }

  const solution = fs.existsSync(solutionPath) ? fs.readFileSync(solutionPath, 'utf8') : '';

  const models = [...new Set(events
    .map((e) => e.data?.by)
    .filter((b) => typeof b === 'string' && b.length))];

  const toolCalls = events.filter((e) => e.type === 'tool/call').map((e) => ({ name: e.data?.name, args: e.data?.arguments }));
  const toolResults = events.filter((e) => e.type === 'tool/result').map((e) => ({ name: e.data?.name, ok: e.data?.ok, error: e.data?.error }));
  const planEvent = events.find((e) => e.type === 'agent.plan');

  // M17/D2 — which provider actually served this task (the audit trail).
  let providerAttempts = [];
  try { if (attemptsApi) providerAttempts = attemptsApi.providerAttempts(); } catch { providerAttempts = []; }

  return {
    solution,
    answer: result ? String(result.answer || '') : '',
    stats: result ? result.stats : null,
    error,
    toolCalls,
    toolResults,
    offeredTools: planEvent ? (planEvent.data?.tools || []).map((t) => t.slug || t.name) : null,
    intent: planEvent ? planEvent.data?.intent : null,
    models,
    providerAttempts,
    providersThatServed: [...new Set(providerAttempts.filter((a) => a.ok).map((a) => a.provider))],
    // M20 — expose the raw event stream so a capture driver can audit
    // recovery/alias/payload-normalization without re-running the loop.
    events,
    transcript: { query, events: events.length },
  };
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, rej) => {
    timer = setTimeout(() => rej(new Error(`agent loop timed out after ${ms}ms`)), ms);
    timer.unref?.(); // never keep the process alive just for the timeout
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Gold leg: write the canonical solution and grade it. Proves the harness. */
export function runGoldTask({ task, sandboxDir }) {
  const solutionPath = path.join(sandboxDir, 'solution.py');
  fs.writeFileSync(solutionPath, `${task.prompt}${task.canonical_solution}\n`);
  return { solution: fs.readFileSync(solutionPath, 'utf8'), gold: true };
}

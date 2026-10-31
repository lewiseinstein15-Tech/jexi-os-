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
 * tools with EMPTY parameter schemas (see lib/README.md):
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
function buildQuery(task, solutionPath, testName) {
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

/**
 * Run one task through JEXI's real agent loop.
 * Returns { solution, transcript, stats, events, error, offeredTools }.
 */
export async function runTaskWithJexi({ task, sandboxDir, schemaMode = 'documented', toolProfile = null, maxIterations = null, timeoutMs = 300_000, log = () => {} }) {
  const { solutionName, testName } = { solutionName: 'solution.py', testName: `test_${task.entry_point}.py` };
  const solutionPath = path.join(sandboxDir, solutionName);

  // Pin the tool workspace to THIS sandbox so writes cannot leak elsewhere.
  const prevWorkspace = process.env.WORKSPACE_DIR;
  process.env.WORKSPACE_DIR = sandboxDir;

  const events = [];
  const sendEvent = (type, data) => { events.push({ type, data }); };
  const query = buildQuery(task, solutionPath, testName);

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
    const opts = { root: sandboxDir };
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

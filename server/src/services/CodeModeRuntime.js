/**
 * B99 — CODE MODE (PTC) — mirror of DeepSeek Harness' `code` preset:
 * `packages/core/tools/src/code-mode.ts` (run_code transport) +
 * `packages/core/tools/src/ts-types.ts` (generated SDK) +
 * `packages/code-runtime/code-runtime-worker-thread` (worker execution).
 *
 * The model writes ONE TypeScript program whose body runs in a worker
 * thread; every `await tools.<name>(args)` inside it is posted to this host,
 * dispatched through JEXI's gated ToolRuntime (permissions, allowlists,
 * risk tiers, approval), and the reply resolves the promise. Only what the
 * program prints or returns comes back — intermediate tool results never
 * enter the conversation (DSH: "curate it").
 */

import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKER_URL = path.join(__dirname, 'code-worker.js');

/** The model-facing tool name (DSH RUN_CODE_NAME). */
export const RUN_CODE_NAME = 'run_code';

/* ------------------------------------------------------------------ */
/* Generated SDK (DSH renderToolsSdk mirror — TypeScript flavor)       */
/* ------------------------------------------------------------------ */

const SDK_INSTRUCTIONS = `## Writing code for run_code

\`run_code\` takes two required arguments: \`code\` — the body of an async TypeScript function (erasable syntax only; type annotations are advisory) — and \`description\`, a short summary of what the program does. Inside the program:

- Call tools as \`await tools.name(args)\` — every call is dispatched through the same permission-gated runtime as native calls. Arguments must be lossless JSON.
- A FAILED tool call rejects with \`ToolCallError\`, whose \`toolName\` identifies the failed tool and whose \`message\` is human-readable — \`try/catch\` it to handle and continue.
- Independent read-only calls MAY overlap under \`Promise.all\` (read calls run concurrently; mutating calls run alone, in submission order). Sequence dependent work with \`await\`.
- Emit results with \`return\` and/or \`console.log(...)\`. ONLY what you print or return comes back to you — extract just what you need.

The available tools:`;

/** Render the TS declaration block for a set of tool defs (DSH ts-types). */
export function renderToolsSdk(defs) {
  const sorted = [...(defs || [])].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const argsMembers = [];
  const outputMembers = [];
  for (const t of sorted) {
    const doc = String(t.desc || t.name || t.slug).replace(/\n+/g, ' ').slice(0, 200);
    argsMembers.push(`  /** ${doc} */`);
    argsMembers.push(`  ${jsonKey(t.slug)}: Record<string, JsonValue>;`);
    outputMembers.push(`  ${jsonKey(t.slug)}: JsonValue;`);
  }
  const argsMap = `interface ToolArgsMap {\n${argsMembers.length ? argsMembers.join('\n') + '\n' : ''}}`;
  const outputMap = `interface ToolOutputMap {\n${outputMembers.length ? outputMembers.join('\n') + '\n' : ''}}`;
  const declaration = [
    argsMap,
    outputMap,
    'type ToolName = keyof ToolOutputMap',
    ['declare class ToolCallError extends Error {', '  readonly name: "ToolCallError";', '  readonly toolName: ToolName;', '}'].join('\n'),
    ['declare const tools: {', '  [K in ToolName]: (args: ToolArgsMap[K]) => Promise<ToolOutputMap[K]>;', '}'].join('\n'),
  ].join('\n\n');
  const jsonValue = 'type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }';
  return `${SDK_INSTRUCTIONS}\n\n\`\`\`ts\n${jsonValue}\n\n${declaration}\n\`\`\``;
}

function jsonKey(name) {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name) ? name : JSON.stringify(name);
}

/** The run_code schema offered to the native loop (DSH run_code parameters). */
export function buildRunCodeSchema() {
  return {
    type: 'function',
    function: {
      name: RUN_CODE_NAME,
      description: 'Execute a TypeScript program against the available tools. Takes two required arguments: `code`, the BODY of an async function (top-level `await` and `return` work), and `description`, a short summary of what the program does. Call tools as `await tools.name(args)` per the SDK declarations in the system prompt. Only what you print or return comes back — curate it.',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'The program: the body of an async TypeScript function.' },
          description: { type: 'string', description: 'Clear, concise description of what this program does in active voice, 5-10 words.' },
        },
        required: ['code', 'description'],
      },
    },
  };
}

/* ------------------------------------------------------------------ */
/* Program execution (DSH code-runtime-worker-thread host mirror)      */
/* ------------------------------------------------------------------ */

/**
 * Run one code-mode program.
 *
 * @param {object} o
 * @param {string} o.code — async function body ('use strict'; top-level await/return).
 * @param {string[]} o.toolNames — visible tool slugs (the SDK the model saw).
 * @param {(name:string, args:object)=>Promise<any>} o.dispatch — executes one
 *   tool call (host side: gated ToolRuntime). Throws on failure.
 * @param {boolean} o.isReadTool — (name) => boolean; read tools run concurrently,
 *   mutating tools run alone in submission order (DSH concurrency contract).
 * @param {number} [o.maxOutputBytes=65536] — log byte budget.
 * @param {number} [o.maxSubCalls=60] — per-program tool-call budget.
 * @param {number} [o.maxRunMs=120000] — wall-clock budget.
 * @param {number} [o.maxParallel=5] — concurrent read calls.
 * @param {AbortSignal} [o.signal] — outer abort (kills the worker).
 * @returns {Promise<{logs:string[], result:any, toolCalls:number, truncated:boolean, durationMs:number, error?:string}>}
 */
export async function runCodeProgram({
  code, toolNames, dispatch, isReadTool,
  maxOutputBytes = 65536, maxSubCalls = 60, maxRunMs = 120000, maxParallel = 5,
  signal,
}) {
  const started = Date.now();
  const logs = [];
  let truncated = false;
  let subCalls = 0;
  let result;
  let runError = null;
  let timedOut = false;

  const worker = new Worker(WORKER_URL, {
    workerData: {
      code: String(code || ''),
      tools: [...(toolNames || [])],
      maxOutputBytes,
      maxResultBytes: 32768,
      maxRunMs,
    },
  });

  const finished = new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      worker.removeAllListeners('message');
      worker.removeAllListeners('error');
      worker.removeAllListeners('exit');
    };
    const settle = (fn, value) => { if (!settled) { settled = true; fn(value); } };

    // Concurrency gate (DSH: read calls overlap; mutating calls serialize).
    let serial = Promise.resolve();
    let inFlight = 0;
    const readSlots = Math.max(1, Number(maxParallel) || 5);
    const readWaiters = [];

    const acquireRead = async () => {
      if (inFlight < readSlots) { inFlight += 1; return; }
      await new Promise((r) => readWaiters.push(r));
      inFlight += 1;
    };
    const releaseRead = () => {
      inFlight -= 1;
      const next = readWaiters.shift();
      if (next) next();
    };

    const handleCall = (message) => {
      const { id, name, args } = message;
      if (subCalls >= maxSubCalls) {
        worker.postMessage({ type: 'reply', id, ok: false, error: `sub-call budget exhausted (max ${maxSubCalls} tool calls per program)` });
        return;
      }
      subCalls += 1;
      const run = async () => {
        try {
          const value = await dispatch(name, args);
          worker.postMessage({ type: 'reply', id, ok: true, value: value === undefined ? null : value });
        } catch (e) {
          worker.postMessage({ type: 'reply', id, ok: false, error: String((e && e.message) || e).slice(0, 400) });
        }
      };
      const isRead = typeof isReadTool === 'function' && isReadTool(name);
      if (isRead) {
        acquireRead().then(async () => {
          try { await run(); } finally { releaseRead(); }
        });
      } else {
        serial = serial.then(run, run);
      }
    };

    worker.on('message', (message) => {
      if (!message || typeof message !== 'object') return;
      if (message.type === 'log') {
        if (!truncated) logs.push(String(message.text));
      } else if (message.type === 'output-limit') {
        truncated = true;
      } else if (message.type === 'call') {
        handleCall(message);
      } else if (message.type === 'done') {
        if (message.error) runError = message.error.message || 'program failed';
        else result = message.result;
        cleanup();
        settle(resolve, { logs, result, runError, subCalls });
      }
    });

    worker.on('error', (e) => {
      cleanup();
      settle(reject, new Error(`code worker failed: ${(e && e.message) || e}`));
    });

    worker.on('exit', (code) => {
      if (settled) return;
      cleanup();
      if (timedOut) {
        settle(resolve, { logs, result: undefined, runError: `program exceeded its run-time budget (${maxRunMs} ms)`, subCalls });
      } else if (code !== 0) {
        settle(reject, new Error(`code worker exited unexpectedly (code ${code})`));
      } else {
        // Clean exit without a done message — honest failure, never a hang.
        settle(resolve, { logs, result: undefined, runError: 'code worker exited without a result', subCalls });
      }
    });
  });

  // Backstop for runaway programs (infinite loops block the worker's own
  // timers): kill the isolate and report a clean budget error.
  const timer = setTimeout(() => {
    timedOut = true;
    worker.terminate().catch(() => {});
  }, maxRunMs + 2000);
  const onAbort = () => { worker.terminate().catch(() => {}); };
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }

  try {
    const out = await finished;
    return {
      logs: out.logs,
      result: out.result,
      toolCalls: out.subCalls,
      truncated,
      durationMs: Date.now() - started,
      ...(out.runError ? { error: out.runError } : {}),
    };
  } catch (e) {
    return {
      logs, result: undefined, toolCalls: subCalls, truncated,
      durationMs: Date.now() - started,
      error: `CODE_RUN_FAILED: ${(e && e.message) || e}`,
    };
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
    worker.terminate().catch(() => {});
  }
}

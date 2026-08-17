/**
 * B99 — CODE-MODE WORKER (mirror of DeepSeek Harness
 * `packages/code-runtime/code-runtime-worker-thread`).
 *
 * Runs one `run_code` program body in a dedicated worker thread. ZERO
 * imports on purpose: the program executes in a separate isolate where the
 * only capabilities are (a) the `tools` binding — every call is posted to
 * the host, which dispatches it through JEXI's gated ToolRuntime — and (b)
 * a captured `console`. Top-level `await` and `return` work; the body is
 * strict mode. Only what the program prints or returns comes back.
 *
 * Protocol (worker → host):
 *   { type: 'log', text }            — one captured console line
 *   { type: 'call', id, name, args } — tool dispatch request
 *   { type: 'output-limit' }         — fired once when the log budget is hit
 *   { type: 'done', result?, error? }— terminal message (always exactly one)
 * Protocol (host → worker):
 *   { type: 'reply', id, ok, value?, error? }
 */

'use strict';

import { parentPort, workerData } from 'node:worker_threads';

const port = parentPort;

function post(message) {
  if (port && typeof port.postMessage === 'function') port.postMessage(message);
}

/* ---------------- log budget (DSH LogBuffer mirror, byte-accurate) ------- */

function makeLogBuffer(maxBytes, onPush, onLimit) {
  let bytes = 2; // JSON serialization of the empty logs array: []
  let entries = 0;
  let truncated = false;
  return {
    push(text) {
      if (truncated) return;
      const separator = entries > 0 ? 1 : 0;
      const textBytes = Buffer.byteLength(String(text), 'utf8');
      const available = maxBytes - bytes - separator;
      if (textBytes > available) {
        truncated = true;
        const prefix = String(text).slice(0, Math.max(0, available));
        if (prefix.length > 0) {
          bytes += Buffer.byteLength(prefix, 'utf8') + separator;
          entries += 1;
          onPush(prefix);
        }
        onLimit();
        return;
      }
      bytes += textBytes + separator;
      entries += 1;
      onPush(text);
    },
    isTruncated() { return truncated; },
  };
}

/* ---------------- console shim (DSH makeConsoleShim mirror) -------------- */

function inspectValue(value) {
  if (typeof value === 'string') return value;
  if (value === null) return 'null';
  if (typeof value === 'undefined') return 'undefined';
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

function makeConsoleShim(logs) {
  const shim = Object.create(null);
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    shim[level] = (...args) => logs.push(args.map(inspectValue).join(' '));
  }
  return shim;
}

/* ---------------- tool bindings (DSH makeNamespaces mirror) -------------- */

function makeBindingErrorClass() {
  return class ToolCallError extends Error {
    constructor(toolName, message) {
      super(String(message));
      this.name = 'ToolCallError';
      this.toolName = toolName;
    }
  };
}

function jsonSnapshot(value, label) {
  let out;
  try {
    out = JSON.parse(JSON.stringify(value, strictJsonReplacer));
  } catch (e) {
    if (e && e.message && /not JSON/i.test(e.message)) {
      throw new Error(`${label} must be lossless JSON (no functions, undefined, or circular values)`);
    }
    throw e;
  }
  if (out === undefined) throw new Error(`${label} must be lossless JSON`);
  return out;
}

/** JSON.stringify replacer that rejects non-JSON values instead of dropping them. */
function strictJsonReplacer(key, value) {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    throw new Error('value is not JSON');
  }
  return value;
}

let nextId = 1;
const pending = new Map();

function makeToolsBinding(toolNames, errorClass, onCall) {
  const tools = Object.create(null);
  for (const name of toolNames) {
    tools[name] = (args) => {
      const snapshot = jsonSnapshot(args === undefined ? {} : args, `arguments to "${name}"`);
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, {
          resolve: (value) => resolve(jsonSnapshot(value, `result of "${name}"`)),
          reject: (message) => reject(new errorClass(name, String(message))),
        });
        onCall({ type: 'call', id, name, args: snapshot });
      });
    };
  }
  return tools;
}

function wireReplies() {
  if (!port || typeof port.on !== 'function') return;
  port.on('message', (message) => {
    if (!message || message.type !== 'reply') return;
    const p = pending.get(message.id);
    if (!p) return;
    pending.delete(message.id);
    if (message.ok) p.resolve(message.value);
    else p.reject(message.error || 'tool call failed');
  });
}

/* ---------------- program execution (DSH runWorkerMain mirror) ----------- */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const data = workerData || {};
  const code = String(data.code || '');
  const maxOutputBytes = Number(data.maxOutputBytes) || 65536;
  const toolNames = Array.isArray(data.tools) ? data.tools : [];

  const logs = makeLogBuffer(maxOutputBytes, (text) => post({ type: 'log', text }), () => post({ type: 'output-limit' }));
  const consoleShim = makeConsoleShim(logs);
  const ToolCallError = makeBindingErrorClass();
  const tools = makeToolsBinding(toolNames, ToolCallError, (call) => post(call));
  wireReplies();

  let done = null;
  try {
    // The async-function constructor via an instance (AsyncFunction is not a
    // global). The program body is strict mode with top-level await + return.
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const fn = new AsyncFunction('tools', 'ToolCallError', 'console', `'use strict';\n${code}`);
    const value = await Promise.race([
      fn(tools, ToolCallError, consoleShim),
      sleep(Number(data.maxRunMs) || 120000).then(() => { throw new Error('program exceeded its run-time budget'); }),
    ]);
    let result;
    if (value !== undefined) {
      try {
        result = JSON.parse(JSON.stringify(value, strictJsonReplacer));
      } catch (e) {
        throw new Error('program return value must be JSON-serializable (return plain objects/arrays/strings/numbers, no undefined fields)');
      }
      if (Buffer.byteLength(JSON.stringify(result), 'utf8') > (Number(data.maxResultBytes) || 32768)) {
        throw new Error('program return value is too large (cap: 32 KB of JSON)');
      }
    }
    done = { type: 'done', result: result === undefined ? undefined : result };
  } catch (error) {
    const message = (error && error.message) || String(error);
    const toolName = error && error.name === 'ToolCallError' && error.toolName ? error.toolName : undefined;
    done = { type: 'done', error: { message, ...(toolName ? { toolName } : {}) } };
  }
  post(done);
  // Give the host a moment to receive the done message before the isolate dies.
  await sleep(50);
}

main().catch((e) => {
  try { post({ type: 'done', error: { message: String((e && e.message) || e) } }); } catch { /* noop */ }
});

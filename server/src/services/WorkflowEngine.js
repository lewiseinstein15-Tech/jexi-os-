/**
 * B115 — WORKFLOW ENGINE (mirror of DeepSeek Harness
 * `packages/workflow/workflow` + `workflow-worker-thread` + `tool-workflow`).
 *
 * The model writes a plain-JS orchestration script that fans work out across
 * subagents with phases and structured results. Script globals (DSH runtime
 * contract):
 *   agent(prompt, opts?)  — delegate one task to a subagent (returns report or null)
 *   parallel([...thunks]) — run agent thunks concurrently (bounded slots)
 *   pipeline(items, ...stages) — apply stages sequentially over items
 *   phase(title)          — narrate a phase (workflow/phase event)
 *   log(message)          — narrate (workflow/log event)
 *   args                  — the JSON args passed by the model
 * The body runs with top-level await and must `return <json-value>`.
 *
 * Error discipline (DSH WorkflowError codes): SCRIPT_PARSE, META_INVALID,
 * INVALID_ARGUMENT, AGENT_CAP, AGENT_START, AGENT_RESULT,
 * RESULT_UNSERIALIZABLE, CANCELLED — fatal errors escape combinators.
 */

import vm from 'node:vm';
import { randomUUID } from 'node:crypto';

const DEFAULT_MAX_AGENTS = 12;   // deployment ceiling (DSH maxTotalAgents analog)
const MAX_PARALLEL_SLOTS = 3;    // concurrent agent() calls from one script
const MAX_RESULT_CHARS = 12000;

/** JSON.stringify replacer that rejects non-JSON values (DSH RESULT_UNSERIALIZABLE). */
function strictJsonReplacer(key, value) {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    throw new Error('value is not JSON');
  }
  return value;
}

/** Workflow error with a DSH code + fatal flag. */
export class WorkflowError extends Error {
  constructor(message, code, { fatal = true, cause } = {}) {
    super(message);
    this.name = 'WorkflowError';
    this.code = code;
    this.fatal = fatal !== false;
    if (cause) this.cause = cause;
  }
}

const runs = new Map(); // runId → record

/** Injectable subagent dispatcher for tests: async (task, opts) => string|null */
let subagentDispatcher = null;
export function setWorkflowDispatcher(fn) {
  subagentDispatcher = typeof fn === 'function' ? fn : null;
}

async function dispatchAgent(task, opts) {
  if (subagentDispatcher) return subagentDispatcher(task, opts || {});
  const { runSubagent } = await import('./SubagentRuntime.js');
  const report = await runSubagent(String(task || '').slice(0, 3000), String((opts && opts.instructions) || '').slice(0, 2000), { depth: Number((opts && opts.depth) || 1) });
  return report ? String(report).slice(0, 6000) : null;
}

function validMeta(meta) {
  if (!meta || typeof meta !== 'object') return false;
  if (typeof meta.name !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(meta.name)) return false;
  if (typeof meta.description !== 'string' || meta.description.trim().length < 5) return false;
  if (meta.whenToUse !== undefined && typeof meta.whenToUse !== 'string') return false;
  if (meta.phases !== undefined && (!Array.isArray(meta.phases) || meta.phases.some((p) => !p || typeof p.title !== 'string'))) return false;
  return true;
}

function recordOf(runId) {
  return runs.get(runId) || null;
}

/** Public run record (events bounded for memory). */
export function workflowRecord(runId) {
  const r = runs.get(String(runId || ''));
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    status: r.status,
    agentsStarted: r.agentsStarted,
    result: r.result,
    error: r.error,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    events: (r.events || []).slice(-40),
  };
}

/** List workflow runs, newest first (bounded). */
export function listWorkflows(limit = 10) {
  return [...runs.values()].sort((a, b) => b.startedAt - a.startedAt).slice(0, Math.max(1, Number(limit) || 10))
    .map((r) => ({ id: r.id, name: r.name, status: r.status, agentsStarted: r.agentsStarted, startedAt: r.startedAt, finishedAt: r.finishedAt }));
}

/**
 * Start a workflow script. Returns the run record; `record.result` resolves
 * with { value, stopReason, error?, agentsStarted } and never rejects
 * (DSH WorkflowRun contract).
 */
export function startWorkflow({ script, meta, args, maxTotalAgents, signal, onEvent } = {}) {
  // META_INVALID — synchronous, before a run exists (DSH).
  if (!validMeta(meta)) {
    throw new WorkflowError(`workflow meta invalid: required name (kebab-case) + description`, 'META_INVALID');
  }
  const body = String(script || '');
  // SCRIPT_PARSE — compile before any realm state exists (DSH).
  let compiled;
  try {
    compiled = new vm.Script(`(async () => {\n${body}\n})()`, { filename: `workflow:${meta.name}` });
  } catch (e) {
    throw new WorkflowError(`workflow script does not parse: ${String((e && e.message) || e)}`, 'SCRIPT_PARSE');
  }

  const run = {
    id: `wf-${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`,
    name: String(meta.name),
    status: 'running',
    agentsStarted: 0,
    result: null,
    error: null,
    startedAt: Date.now(),
    finishedAt: null,
    events: [],
  };
  runs.set(run.id, run);

  const emit = (type, data) => {
    const ev = { type, at: Date.now(), ...data };
    try { run.events.push(ev); } catch { /* noop */ }
    try { if (typeof onEvent === 'function') onEvent(type, data); } catch { /* noop */ }
  };

  emit('workflow/start', { runId: run.id, name: run.name });

  // Execution promise — never rejects (DSH: WorkflowRun.result never rejects).
  const resultPromise = (async () => {
    let slots = MAX_PARALLEL_SLOTS;
    const waiters = [];
    const acquire = async () => {
      if (slots > 0) { slots -= 1; return; }
      await new Promise((r) => waiters.push(r));
      slots -= 1;
    };
    const release = () => { slots += 1; const w = waiters.shift(); if (w) w(); };
    let cancelled = false;
    const cancelReason = () => (cancelled ? 'workflow cancelled' : null);
    const throwIfCancelled = () => { if (cancelled) throw new WorkflowError('workflow cancelled', 'CANCELLED'); };

    const context = vm.createContext({}, { name: `workflow:${run.name}` });
    const agent = async (prompt, opts) => {
      throwIfCancelled();
      if (run.agentsStarted >= (Number(maxTotalAgents) > 0 ? maxTotalAgents : DEFAULT_MAX_AGENTS)) {
        throw new WorkflowError(`agent cap reached (${run.agentsStarted})`, 'AGENT_CAP');
      }
      if (typeof prompt !== 'string' || !prompt.trim()) throw new WorkflowError('agent() requires a task string', 'INVALID_ARGUMENT');
      run.agentsStarted += 1;
      emit('workflow/agent-start', { runId: run.id, seq: run.agentsStarted, task: String(prompt).slice(0, 120) });
      await acquire();
      try {
        throwIfCancelled();
        const report = await dispatchAgent(prompt, opts || {});
        emit('workflow/agent-end', { runId: run.id, seq: run.agentsStarted, ok: !!report });
        return report === null || report === undefined ? null : String(report).slice(0, 6000);
      } catch (e) {
        if (cancelled) throw new WorkflowError('workflow cancelled', 'CANCELLED');
        if (e instanceof WorkflowError) throw e;
        throw new WorkflowError(`subagent start failed: ${(e && e.message) || e}`, 'AGENT_START');
      } finally {
        release();
      }
    };
    const parallel = async (thunks) => {
      throwIfCancelled();
      if (!Array.isArray(thunks)) throw new WorkflowError('parallel() requires an array of functions', 'INVALID_ARGUMENT');
      const out = new Array(thunks.length);
      let next = 0;
      const worker = async () => {
        while (next < thunks.length) {
          const i = next; next += 1;
          const thunk = thunks[i];
          if (typeof thunk !== 'function') throw new WorkflowError('parallel() entries must be functions', 'INVALID_ARGUMENT');
          out[i] = await thunk();
        }
      };
      const workers = Array.from({ length: Math.min(MAX_PARALLEL_SLOTS, thunks.length) }, () => worker());
      await Promise.all(workers);
      return out;
    };
    const pipeline = async (items, ...stages) => {
      throwIfCancelled();
      if (!Array.isArray(items)) throw new WorkflowError('pipeline() requires an items array', 'INVALID_ARGUMENT');
      let current = items;
      for (const stage of stages) {
        if (typeof stage !== 'function') throw new WorkflowError('pipeline() stages must be functions', 'INVALID_ARGUMENT');
        current = await stage(current);
        if (!Array.isArray(current)) throw new WorkflowError('pipeline() stages must return an array', 'INVALID_ARGUMENT');
      }
      return current;
    };
    const phase = (title) => {
      throwIfCancelled();
      emit('workflow/phase', { runId: run.id, title: String(title || '').slice(0, 80) });
    };
    const log = (message) => {
      throwIfCancelled();
      emit('workflow/log', { runId: run.id, message: String(message || '').slice(0, 300) });
    };
    const globals = {
      agent: Object.freeze(agent),
      parallel: Object.freeze(parallel),
      pipeline: Object.freeze(pipeline),
      phase: Object.freeze(phase),
      log: Object.freeze(log),
      args,
    };
    for (const [k, v] of Object.entries(globals)) context[k] = v;

    // Cancellation bridge.
    const onAbort = () => { cancelled = true; };
    if (signal) {
      if (signal.aborted) cancelled = true;
      else signal.addEventListener('abort', onAbort, { once: true });
    }

    try {
      const value = await compiled.runInContext(context, { timeout: 180000 });
      let serialized;
      try { serialized = JSON.parse(JSON.stringify(value, strictJsonReplacer)); }
      catch {
        throw new WorkflowError('workflow result is not JSON-serializable (return plain JSON data — no functions, undefined, or circular values)', 'RESULT_UNSERIALIZABLE');
      }
      if (serialized === undefined) serialized = null;
      const text = JSON.stringify(serialized);
      if (text && text.length > MAX_RESULT_CHARS) {
        throw new WorkflowError(`workflow result too large (${text.length} chars > ${MAX_RESULT_CHARS})`, 'RESULT_UNSERIALIZABLE');
      }
      run.status = 'completed';
      run.result = serialized;
      emit('workflow/end', { runId: run.id, stopReason: 'completed', agentsStarted: run.agentsStarted });
      return { value: serialized, stopReason: 'completed', agentsStarted: run.agentsStarted };
    } catch (e) {
      const wf = e instanceof WorkflowError ? e : new WorkflowError(String((e && e.message) || e), 'AGENT_RESULT', { fatal: false });
      run.status = wf.code === 'CANCELLED' ? 'cancelled' : 'failed';
      run.error = `${wf.code}: ${wf.message}`;
      emit('workflow/end', { runId: run.id, stopReason: run.status === 'cancelled' ? 'cancelled' : 'error', agentsStarted: run.agentsStarted });
      return { value: null, stopReason: run.status === 'cancelled' ? 'cancelled' : 'error', error: { code: wf.code, message: wf.message }, agentsStarted: run.agentsStarted };
    } finally {
      run.finishedAt = Date.now();
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  })();

  run.result = resultPromise;
  return run;
}

/**
 * EXECUTION BACKEND — Ultimate Architecture Upgrade §38 (Sept 2026).
 *
 * One seam between the Task Graph and wherever work actually runs:
 *
 *   ┌────────────┐     ┌──────────────────────┐     ┌─────────────────────┐
 *   │ TaskGraph  │ ──▶ │ ExecutionBackend     │ ──▶ │ JexiNativeBackend   │
 *   │ (§12–§16)  │     │ (this module)        │     │ WorkerRouter+LLM    │
 *   └────────────┘     └──────────────────────┘     └─────────────────────┘
 *
 * JexiNativeBackend (shipped): a task runs through the EXISTING worker lane
 * — WorkerRouter.runWorker with the task's agent role, tools and abort
 * signal. Nothing working was rewritten; the graph calls the same engine the
 * chat loop already uses.
 *
 * OrcaBackend (DESIGNED, NOT BUILT): the studied interface a future Orca
 * execution backend would implement — dispatch a task to an isolated Orca
 * Run/Worker (worktree, lifecycle states, retries) and await its result. It
 * is deliberately NOT implemented: JEXI must work fully without Orca, and no
 * dependency is added until a real integration is justified (see
 * docs/research/orca-study.md). Registering one later is one call:
 * registerBackend('orca', new OrcaBackend(...)).
 *
 * Backend contract: execute(task, ctx) → { result } | { status:'waiting',
 * payload } | throws on failure. ctx = { run, signal, tools }.
 */

import { runWorker } from './WorkerRouter.js';

const backends = new Map();

/** The native backend: a task = one worker turn through the real engine. */
export const JexiNativeBackend = {
  id: 'jexi-native',
  label: 'JEXI Native (WorkerRouter + LLM providers)',
  available: () => true, // always available — it IS JEXI
  async execute(task, ctx = {}) {
    const role = task.agent || 'jexi';
    const prompt = task.prompt || task.title || '';
    const out = await runWorker(role, prompt, '', {
      tools: Array.isArray(ctx.tools) && ctx.tools.length ? ctx.tools : undefined,
      signal: ctx.signal || undefined,
    });
    return { result: out };
  },
};

export function registerBackend(backend) {
  if (!backend || !backend.id || typeof backend.execute !== 'function') {
    throw new Error('an ExecutionBackend needs { id, execute(task, ctx) }');
  }
  backends.set(backend.id, backend);
}

export function getBackend(id = 'jexi-native') {
  const b = backends.get(id);
  if (b) return b;
  if (id === 'jexi-native') { registerBackend(JexiNativeBackend); return JexiNativeBackend; }
  throw new Error(`execution backend '${id}' is not registered (DESIGNED ≠ BUILT — §38)`);
}

export function listBackends() {
  if (!backends.has('jexi-native')) registerBackend(JexiNativeBackend);
  return [...backends.values()].map((b) => ({ id: b.id, label: b.label || b.id, available: b.available ? b.available() : true }));
}

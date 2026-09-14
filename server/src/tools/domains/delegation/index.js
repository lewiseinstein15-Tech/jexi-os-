/**
 * JEXI OS — tools — delegation domain.
 *
 * spawn, await. Executors are injected; definitions are always registered so the
 * capability surface stays stable and provider-independent.
 */

import { defineTool } from '../../interface/ToolDefinition.js';
import { registerToolBatch } from '../../registry/ToolRegistry.js';
import { runSubagent } from '../../../services/SubagentRuntime.js';

// A real spawn/await handle: the task is handed to an actual subagent runtime
// (own context window + agent loop); `await` blocks on the real result.
const handles = new Map();
let handleSeq = 0;

export function registerDelegationTools() {
  const defs = [
    defineTool({ name: 'delegate_spawn', description: 'Spawn a subagent to run a task in its own context.', riskLevel: 'medium', runtimeRing: 2, parameters: { type: 'object', properties: { task: { type: 'string' } }, required: ['task'] }, sideEffects: ['delegate'], failureTypes: ['tool_error'], idempotent: false }),
    defineTool({ name: 'delegate_await', description: 'Block on a spawned subagent and return its final result.', riskLevel: 'medium', runtimeRing: 2, parameters: { type: 'object', properties: { handle: { type: 'string' } }, required: ['handle'] }, sideEffects: ['delegate'], failureTypes: ['tool_error'], idempotent: false })
  ];
  const unreg = registerToolBatch(defs);
  const engines = {
    async delegate_spawn({ task }, _ctx = {}) {
      const handle = `sub-${Date.now().toString(36)}-${++handleSeq}`;
      const promise = runSubagent(String(task || ''), '', {});
      handles.set(handle, promise);
      const report = await promise.catch(() => null);
      handles.delete(handle);
      const taskText = String(task || '').slice(0, 200);
      const summary = String(report && typeof report === 'object' ? (report.answer ?? report.result ?? JSON.stringify(report)) : report || '').slice(0, 3000);
      return {
        ok: true,
        handle,
        status: report ? 'done' : 'failed',
        task: taskText,
        result: summary,
      };
    },
    async delegate_await({ handle }, _ctx = {}) {
      const promise = handles.get(String(handle || ''));
      if (!promise) return { ok: false, error: `unknown delegate handle "${handle}"` };
      const report = await promise;
      handles.delete(handle);
      return { ok: true, handle, result: String(report || '').slice(0, 3000) };
    },
  };
  return { unreg, engines };
}

/**
 * JEXI OS — tools — delegation domain.
 *
 * spawn, await. Executors are injected; definitions are always registered so the
 * capability surface stays stable and provider-independent.
 */

import { defineTool } from '../../interface/ToolDefinition.js';
import { registerToolBatch } from '../../registry/ToolRegistry.js';

export function registerDelegationTools() {
  const defs = [
    defineTool({ name: 'delegate_spawn', description: 'delegate spawn tool.', riskLevel: 'medium', runtimeRing: 2, parameters: { type: 'object', properties: { }, required: [] }, sideEffects: ['delegate'], failureTypes: ['tool_error'], idempotent: false }),
    defineTool({ name: 'delegate_await', description: 'delegate await tool.', riskLevel: 'medium', runtimeRing: 2, parameters: { type: 'object', properties: { }, required: [] }, sideEffects: ['delegate'], failureTypes: ['tool_error'], idempotent: false })
  ];
  const unreg = registerToolBatch(defs);
  const engines = {
    delegate_spawn: async (args) => { throw new Error('engine delegate_spawn not configured'); },
    delegate_await: async (args) => { throw new Error('engine delegate_await not configured'); }
  };
  return { unreg, engines };
}

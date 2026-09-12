/**
 * JEXI OS — tools — communication domain.
 *
 * notify, ask. Executors are injected; definitions are always registered so the
 * capability surface stays stable and provider-independent.
 */

import { defineTool } from '../../interface/ToolDefinition.js';
import { registerToolBatch } from '../../registry/ToolRegistry.js';

export function registerCommunicationTools() {
  const defs = [
    defineTool({ name: 'comm_notify', description: 'comm notify tool.', riskLevel: 'medium', runtimeRing: 2, parameters: { type: 'object', properties: { }, required: [] }, sideEffects: ['comm'], failureTypes: ['tool_error'], idempotent: false }),
    defineTool({ name: 'comm_ask', description: 'comm ask tool.', riskLevel: 'medium', runtimeRing: 2, parameters: { type: 'object', properties: { }, required: [] }, sideEffects: ['comm'], failureTypes: ['tool_error'], idempotent: false })
  ];
  const unreg = registerToolBatch(defs);
  const engines = {
    comm_notify: async (args) => { throw new Error('engine comm_notify not configured'); },
    comm_ask: async (args) => { throw new Error('engine comm_ask not configured'); }
  };
  return { unreg, engines };
}

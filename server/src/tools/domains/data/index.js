/**
 * JEXI OS — tools — data domain.
 *
 * json, csv, sql. Executors are injected; definitions are always registered so the
 * capability surface stays stable and provider-independent.
 */

import { defineTool } from '../../interface/ToolDefinition.js';
import { registerToolBatch } from '../../registry/ToolRegistry.js';

export function registerDataTools() {
  const defs = [
    defineTool({ name: 'data_json', description: 'data json tool.', riskLevel: 'low', runtimeRing: 2, parameters: { type: 'object', properties: { }, required: [] }, sideEffects: ['data'], failureTypes: ['tool_error'], idempotent: false }),
    defineTool({ name: 'data_csv', description: 'data csv tool.', riskLevel: 'low', runtimeRing: 2, parameters: { type: 'object', properties: { }, required: [] }, sideEffects: ['data'], failureTypes: ['tool_error'], idempotent: false }),
    defineTool({ name: 'data_sql', description: 'data sql tool.', riskLevel: 'low', runtimeRing: 2, parameters: { type: 'object', properties: { }, required: [] }, sideEffects: ['data'], failureTypes: ['tool_error'], idempotent: false })
  ];
  const unreg = registerToolBatch(defs);
  const engines = {
    data_json: async (args) => { throw new Error('engine data_json not configured'); },
    data_csv: async (args) => { throw new Error('engine data_csv not configured'); },
    data_sql: async (args) => { throw new Error('engine data_sql not configured'); }
  };
  return { unreg, engines };
}

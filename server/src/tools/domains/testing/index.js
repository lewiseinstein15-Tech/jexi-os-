/**
 * JEXI OS — tools — testing domain.
 *
 * run, coverage. Executors are injected; definitions are always registered so the
 * capability surface stays stable and provider-independent.
 */

import { defineTool } from '../../interface/ToolDefinition.js';
import { registerToolBatch } from '../../registry/ToolRegistry.js';

export function registerTestingTools() {
  const defs = [
    defineTool({ name: 'test_run', description: 'test run tool.', riskLevel: 'medium', runtimeRing: 2, parameters: { type: 'object', properties: { }, required: [] }, sideEffects: ['test'], failureTypes: ['tool_error'], idempotent: false }),
    defineTool({ name: 'test_coverage', description: 'test coverage tool.', riskLevel: 'medium', runtimeRing: 2, parameters: { type: 'object', properties: { }, required: [] }, sideEffects: ['test'], failureTypes: ['tool_error'], idempotent: false })
  ];
  const unreg = registerToolBatch(defs);
  const engines = {
    test_run: async (args) => { throw new Error('engine test_run not configured'); },
    test_coverage: async (args) => { throw new Error('engine test_coverage not configured'); }
  };
  return { unreg, engines };
}

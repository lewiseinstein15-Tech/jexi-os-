/**
 * JEXI OS — tools — lsp domain.
 *
 * diagnostics, definition, references. Executors are injected; definitions are always registered so the
 * capability surface stays stable and provider-independent.
 */

import { defineTool } from '../../interface/ToolDefinition.js';
import { registerToolBatch } from '../../registry/ToolRegistry.js';

export function registerLspTools() {
  const defs = [
    defineTool({ name: 'lsp_diagnostics', description: 'lsp diagnostics tool.', riskLevel: 'low', runtimeRing: 2, parameters: { type: 'object', properties: { }, required: [] }, sideEffects: ['lsp'], failureTypes: ['tool_error'], idempotent: false }),
    defineTool({ name: 'lsp_definition', description: 'lsp definition tool.', riskLevel: 'low', runtimeRing: 2, parameters: { type: 'object', properties: { }, required: [] }, sideEffects: ['lsp'], failureTypes: ['tool_error'], idempotent: false }),
    defineTool({ name: 'lsp_references', description: 'lsp references tool.', riskLevel: 'low', runtimeRing: 2, parameters: { type: 'object', properties: { }, required: [] }, sideEffects: ['lsp'], failureTypes: ['tool_error'], idempotent: false })
  ];
  const unreg = registerToolBatch(defs);
  const engines = {
    lsp_diagnostics: async (args) => { throw new Error('engine lsp_diagnostics not configured'); },
    lsp_definition: async (args) => { throw new Error('engine lsp_definition not configured'); },
    lsp_references: async (args) => { throw new Error('engine lsp_references not configured'); }
  };
  return { unreg, engines };
}

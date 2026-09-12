/**
 * JEXI OS — tools — browser domain.
 *
 * navigate, click, type, extract — browser automation. Executors are injected; definitions are always registered so the
 * capability surface stays stable and provider-independent.
 */

import { defineTool } from '../../interface/ToolDefinition.js';
import { registerToolBatch } from '../../registry/ToolRegistry.js';

export function registerBrowserTools() {
  const defs = [
    defineTool({ name: 'nav_click', description: 'nav click tool.', riskLevel: 'medium', runtimeRing: 2, parameters: { type: 'object', properties: { }, required: [] }, sideEffects: ['nav'], failureTypes: ['tool_error'], idempotent: false }),
    defineTool({ name: 'nav_type', description: 'nav type tool.', riskLevel: 'medium', runtimeRing: 2, parameters: { type: 'object', properties: { }, required: [] }, sideEffects: ['nav'], failureTypes: ['tool_error'], idempotent: false }),
    defineTool({ name: 'nav_extract', description: 'nav extract tool.', riskLevel: 'medium', runtimeRing: 2, parameters: { type: 'object', properties: { }, required: [] }, sideEffects: ['nav'], failureTypes: ['tool_error'], idempotent: false }),
    defineTool({ name: 'nav_navigate', description: 'nav navigate tool.', riskLevel: 'medium', runtimeRing: 2, parameters: { type: 'object', properties: { }, required: [] }, sideEffects: ['nav'], failureTypes: ['tool_error'], idempotent: false })
  ];
  const unreg = registerToolBatch(defs);
  const engines = {
    nav_click: async (args) => { throw new Error('engine nav_click not configured'); },
    nav_type: async (args) => { throw new Error('engine nav_type not configured'); },
    nav_extract: async (args) => { throw new Error('engine nav_extract not configured'); },
    nav_navigate: async (args) => { throw new Error('engine nav_navigate not configured'); }
  };
  return { unreg, engines };
}

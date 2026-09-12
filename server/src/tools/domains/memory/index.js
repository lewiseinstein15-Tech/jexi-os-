/**
 * JEXI OS — tools — memory domain.
 *
 * store / recall / forget — MemoryProvider backends are injected (Phase 3
 * segment), definitions registered now for API stability.
 */

import { defineTool } from '../../interface/ToolDefinition.js';
import { registerToolBatch } from '../../registry/ToolRegistry.js';

export function registerMemTools() {
  const store = defineTool({
    name: 'mem_store', description: 'Persist a fact under a key.', riskLevel: 'medium', runtimeRing: 1,
    parameters: { type: 'object', properties: { key: { type: 'string' }, value: {} }, required: ['key', 'value'] },
    sideEffects: ['write'], idempotent: true,
  });
  const recall = defineTool({
    name: 'mem_recall', description: 'Recall a fact by key or prefix.', riskLevel: 'low', runtimeRing: 1, idempotent: true,
    parameters: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] },
  });
  const forget = defineTool({
    name: 'mem_forget', description: 'Delete a stored fact.', riskLevel: 'critical', runtimeRing: 1,
    parameters: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] },
    sideEffects: ['delete'], idempotent: true,
  });
  const unreg = registerToolBatch([store, recall, forget]);

  const engines = {
    mem_store: async (args, { memory = new Map() }) => { memory.set(args.key, args.value); return { ok: true }; },
    mem_recall: async (args, { memory = new Map() }) => memory.get(args.key) ?? null,
    mem_forget: async (args, { memory = new Map() }) => { memory.delete(args.key); return { ok: true }; },
  };
  return { unreg, engines };
}
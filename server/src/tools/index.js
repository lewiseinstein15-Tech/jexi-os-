/**
 * JEXI OS — tools — public API.
 *
 *   registerTool / registerToolBatch / getTool / hasTool / listTools
 *   validateCall
 *   makeExecutor / makePermissionGate / makeRiskGuard
 *   ToolCall / ToolResult / defineTool / validateToolDefinition
 *   registerAllDomains()
 *   runToolCalls(response, executor) — agent-loop integration:
 *        NormalizedResponse.tool_calls → ToolCall → validation → gate → execute
 *
 * The agent loop imports ONLY this module — never provider internals.
 */

import { ToolCall } from './interface/ToolCall.js';
import { ToolResult } from './interface/ToolResult.js';
import { defineTool, validateToolDefinition } from './interface/ToolDefinition.js';
import { registerTool, registerToolBatch, getTool, hasTool, listTools, validateCall } from './registry/ToolRegistry.js';
import { makeExecutor, denyByDefault } from './execution/executor.js';
import { makePermissionGate } from './execution/permission-gate.js';
import { makeRiskGuard } from './execution/risk-guard.js';
import { validateSchema } from './registry/schema-validator.js';
import { registerAllDomains } from './domains/index.js';

export {
  ToolCall, ToolResult, defineTool, validateToolDefinition,
  registerTool, registerToolBatch, getTool, hasTool, listTools, validateCall,
  makeExecutor, denyByDefault, makePermissionGate, makeRiskGuard,
  validateSchema, registerAllDomains,
};

/**
 * Agent-loop integration: take a NormalizedResponse's tool_calls, run every
 * call through the executor (schema → permission → risk → engine), and return
 * ToolResults ready to feed back to the provider layer.
 *
 * @param {object|NormalizedResponse} response  has .tool_calls (normalized)
 * @param {object} executor  from makeExecutor()
 * @param {object} [ctx]     execution context (root, memory, confirm, ...)
 * @returns {Promise<ToolResult[]>}
 */
export async function runToolCalls(response, executor, ctx = {}) {
  const calls = response?.tool_calls ?? [];
  if (!calls.length) return [];
  const out = [];
  for (const raw of calls) {
    const call = raw instanceof ToolCall ? raw : ToolCall.from(raw);
    out.push(await executor.execute(call, ctx));
  }
  return out;
}
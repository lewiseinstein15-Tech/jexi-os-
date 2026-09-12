/**
 * JEXI OS — tools — git domain.
 *
 * status, diff, commit, branch, log. Executors are injected; definitions are always registered so the
 * capability surface stays stable and provider-independent.
 */

import { defineTool } from '../../interface/ToolDefinition.js';
import { registerToolBatch } from '../../registry/ToolRegistry.js';

export function registerGitTools() {
  const defs = [
    defineTool({ name: 'git_status', description: 'git status tool.', riskLevel: 'medium', runtimeRing: 2, parameters: { type: 'object', properties: { }, required: [] }, sideEffects: ['git'], failureTypes: ['tool_error'], idempotent: false }),
    defineTool({ name: 'git_diff', description: 'git diff tool.', riskLevel: 'medium', runtimeRing: 2, parameters: { type: 'object', properties: { }, required: [] }, sideEffects: ['git'], failureTypes: ['tool_error'], idempotent: false }),
    defineTool({ name: 'git_commit', description: 'git commit tool.', riskLevel: 'medium', runtimeRing: 2, parameters: { type: 'object', properties: { }, required: [] }, sideEffects: ['git'], failureTypes: ['tool_error'], idempotent: false }),
    defineTool({ name: 'git_branch', description: 'git branch tool.', riskLevel: 'medium', runtimeRing: 2, parameters: { type: 'object', properties: { }, required: [] }, sideEffects: ['git'], failureTypes: ['tool_error'], idempotent: false }),
    defineTool({ name: 'git_log', description: 'git log tool.', riskLevel: 'medium', runtimeRing: 2, parameters: { type: 'object', properties: { }, required: [] }, sideEffects: ['git'], failureTypes: ['tool_error'], idempotent: false })
  ];
  const unreg = registerToolBatch(defs);
  const engines = {
    git_status: async (args) => { throw new Error('engine git_status not configured'); },
    git_diff: async (args) => { throw new Error('engine git_diff not configured'); },
    git_commit: async (args) => { throw new Error('engine git_commit not configured'); },
    git_branch: async (args) => { throw new Error('engine git_branch not configured'); },
    git_log: async (args) => { throw new Error('engine git_log not configured'); }
  };
  return { unreg, engines };
}

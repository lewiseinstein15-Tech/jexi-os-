/**
 * JEXI OS — tools — github domain.
 *
 * pr-create, pr-review, issue-list. Executors are injected; definitions are always registered so the
 * capability surface stays stable and provider-independent.
 */

import { defineTool } from '../../interface/ToolDefinition.js';
import { registerToolBatch } from '../../registry/ToolRegistry.js';

export function registerGithubTools() {
  const defs = [
    defineTool({ name: 'gh_pr_create', description: 'gh pr create tool.', riskLevel: 'medium', runtimeRing: 2, parameters: { type: 'object', properties: { }, required: [] }, sideEffects: ['gh'], failureTypes: ['tool_error'], idempotent: false }),
    defineTool({ name: 'gh_pr_review', description: 'gh pr review tool.', riskLevel: 'medium', runtimeRing: 2, parameters: { type: 'object', properties: { }, required: [] }, sideEffects: ['gh'], failureTypes: ['tool_error'], idempotent: false }),
    defineTool({ name: 'gh_issue_list', description: 'gh issue list tool.', riskLevel: 'medium', runtimeRing: 2, parameters: { type: 'object', properties: { }, required: [] }, sideEffects: ['gh'], failureTypes: ['tool_error'], idempotent: false })
  ];
  const unreg = registerToolBatch(defs);
  const engines = {
    gh_pr_create: async (args) => { throw new Error('engine gh_pr_create not configured'); },
    gh_pr_review: async (args) => { throw new Error('engine gh_pr_review not configured'); },
    gh_issue_list: async (args) => { throw new Error('engine gh_issue_list not configured'); }
  };
  return { unreg, engines };
}

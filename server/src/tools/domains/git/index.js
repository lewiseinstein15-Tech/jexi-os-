/**
 * JEXI OS — tools — git domain.
 *
 * status, diff, commit, branch, log. Executors are injected; definitions are always registered so the
 * capability surface stays stable and provider-independent.
 */

import { defineTool } from '../../interface/ToolDefinition.js';
import { registerToolBatch } from '../../registry/ToolRegistry.js';
import { runNativeCommand } from '../../../services/NativeCommand.js';

async function git(args, ctx, ...extra) {
  const cwd = ctx.root ?? process.cwd();
  const res = await runNativeCommand('git', [...extra], { cwd, timeoutMs: 20000 });
  return { ok: res.code === 0, command: `git ${extra.join(' ')}`, output: res.output ?? '', code: res.code, ...(res.error && res.code !== 0 ? { error: res.error } : {}) };
}

export function registerGitTools() {
  const defs = [
    defineTool({ name: 'git_status', description: 'git status tool.', riskLevel: 'medium', runtimeRing: 2, parameters: { type: 'object', properties: { }, required: [] }, sideEffects: ['git'], failureTypes: ['tool_error'], idempotent: false }),
    defineTool({ name: 'git_diff', description: 'git diff tool.', riskLevel: 'medium', runtimeRing: 2, parameters: { type: 'object', properties: { }, required: [] }, sideEffects: ['git'], failureTypes: ['tool_error'], idempotent: false }),
    defineTool({ name: 'git_commit', description: 'git commit tool.', riskLevel: 'medium', runtimeRing: 2, parameters: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] }, sideEffects: ['git'], failureTypes: ['tool_error'], idempotent: false }),
    defineTool({ name: 'git_branch', description: 'git branch tool.', riskLevel: 'medium', runtimeRing: 2, parameters: { type: 'object', properties: { }, required: [] }, sideEffects: ['git'], failureTypes: ['tool_error'], idempotent: false }),
    defineTool({ name: 'git_log', description: 'git log tool.', riskLevel: 'medium', runtimeRing: 2, parameters: { type: 'object', properties: { n: { type: 'integer' } }, required: [] }, sideEffects: ['git'], failureTypes: ['tool_error'], idempotent: false })
  ];
  const unreg = registerToolBatch(defs);
  const engines = {
    git_status: (args, ctx) => git(args, ctx, 'status', '--short', '--branch'),
    git_diff: (args, ctx) => git(args, ctx, 'diff', '--stat'),
    git_commit: async ({ message }, ctx = {}) => {
      const cwd = ctx.root ?? process.cwd();
      const add = await runNativeCommand('git', ['add', '-A'], { cwd });
      if (add.code !== 0) return { ok: false, error: `git add failed: ${add.output}`, output: add.output, code: add.code };
      const res = await runNativeCommand('git', ['commit', '-m', String(message || '').slice(0, 200)], { cwd });
      return { ok: res.code === 0, output: res.output ?? '', code: res.code, ...(res.error && res.code !== 0 ? { error: res.error } : {}) };
    },
    git_branch: (args, ctx) => git(args, ctx, 'branch', '--list'),
    git_log: ({ n } = {}, ctx = {}) => git(ctx, ctx, 'log', '--oneline', `-${Math.min(Number(n) || 20, 50)}`),
  };
  return { unreg, engines };
}

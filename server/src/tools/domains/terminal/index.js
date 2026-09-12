/**
 * JEXI OS — tools — terminal domain.
 *
 * execute (a command in a project sandbox) + session (interactive). The
 * command executor is injected to keep the domain keyless and testable; real
 * deployments pass the node-pty / child_process bridge.
 */

import { defineTool } from '../../interface/ToolDefinition.js';
import { registerToolBatch } from '../../registry/ToolRegistry.js';

export function registerTerminalTools() {
  const execute = defineTool({
    name: 'term_execute', description: 'Run a shell command in the sandbox and return stdout/stderr.',
    riskLevel: 'medium', runtimeRing: 2,
    parameters: { type: 'object', properties: { command: { type: 'string' }, cwd: { type: 'string' }, timeoutMs: { type: 'integer' } }, required: ['command'] },
    sideEffects: ['execute'], idempotent: false,
    failureTypes: ['command_failed', 'timeout'],
  });
  const session = defineTool({
    name: 'term_session', description: 'Spawn or reuse an interactive shell session.',
    riskLevel: 'medium', runtimeRing: 2,
    parameters: { type: 'object', properties: { action: { type: 'string', enum: ['start', 'send', 'end'] }, input: { type: 'string' } }, required: ['action'] },
    sideEffects: ['execute'], idempotent: false,
  });
  const unreg = registerToolBatch([execute, session]);

  const engines = {
    term_execute: async (args) => ({ ran: true, command: args.command, stdout: '(engine not configured)' }),
    term_session: async (args) => ({ session: 'unconfigured' }),
  };
  return { unreg, engines };
}
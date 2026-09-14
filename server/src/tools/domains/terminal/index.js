/**
 * JEXI OS — tools — terminal domain.
 *
 * execute (a command in a project sandbox) + session (interactive). The
 * command executor is injected to keep the domain keyless and testable; real
 * deployments pass the node-pty / child_process bridge.
 */

import { defineTool } from '../../interface/ToolDefinition.js';
import { registerToolBatch } from '../../registry/ToolRegistry.js';
import { runNativeCommand } from '../../../services/NativeCommand.js';
import { runPersistentBash, resetShell, listPersistentShells } from '../../../services/BashPersistent.js';

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
    term_execute: async ({ command, cwd, timeoutMs }, ctx = {}) => {
      const p = ctx.root ?? process.cwd();
      const res = await runNativeCommand('bash', ['-lc', String(command || '')], { timeoutMs: Number(timeoutMs) || 30000, cwd: cwd ?? p });
      return {
        ran: res.ok,
        ok: res.ok,
        command,
        stdout: res.stdout ?? '',
        stderr: res.stderr ?? '',
        output: res.output ?? '',
        code: res.code ?? null,
        durationMs: res.durationMs ?? 0,
        ...(res.error ? { error: res.error } : {}),
      };
    },
    term_session: async ({ action, input }, ctx = {}) => {
      const owner = ctx.owner ?? 'term-session';
      const cwd = ctx.root ?? process.cwd();
      if (action === 'start') {
        const res = await runPersistentBash({ owner, command: 'echo session-ready && pwd', cwd, reset: true });
        return { ok: res.ok, session: owner, output: res.output, code: res.code };
      }
      if (action === 'send') {
        const res = await runPersistentBash({ owner, command: String(input || ''), cwd });
        return { ok: res.ok, session: owner, output: res.output, code: res.code, durationMs: res.durationMs };
      }
      if (action === 'end') {
        resetShell(owner, 'client requested end');
        return { ok: true, session: owner, ended: true, sessions: listPersistentShells() };
      }
      return { ok: false, error: `unknown action "${action}"` };
    },
  };
  return { unreg, engines };
}
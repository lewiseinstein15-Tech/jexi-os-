/**
 * JEXI OS — tools — terminal domain.
 *
 * execute (a command in the session sandbox) + session (interactive).
 *
 * JEXI-001 / JEXI-011 / JEXI-015 — what changed and why:
 *
 * - The tool used to be described as running "in the sandbox" while
 *   executing `bash -lc <command>` directly on the host. The description was
 *   a lie (JEXI-011) and the execution had no isolation (JEXI-001). It now
 *   routes through SessionSandbox and the description states the REAL runtime,
 *   including when the runtime is degraded.
 *
 * - `bash -lc` for every command (JEXI-015) forced a full login shell, which
 *   runs the user's profile scripts, widens the injection surface and makes
 *   sandboxing awkward. Commands that do not need shell features now run
 *   argv-only with shell:false. `bash -lc` remains available as an explicit,
 *   documented opt-in (`shell: true`) for pipelines and redirects.
 */

import { defineTool } from '../../interface/ToolDefinition.js';
import { registerToolBatch } from '../../registry/ToolRegistry.js';
import { runNativeCommand } from '../../../services/NativeCommand.js';
import { runPersistentBash, resetShell, listPersistentShells } from '../../../services/BashPersistent.js';
import { sessionSandbox } from '../../../services/Sandbox.js';

export function registerTerminalTools({ useSandbox = true } = {}) {
  const execute = defineTool({
    name: 'term_execute',
    description: 'Run a command in the session sandbox and return stdout/stderr. The result records the real execution backend; when the host has no container runtime the sandbox is reported as degraded.',
    riskLevel: 'medium', runtimeRing: 2,
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        argv: { type: 'array', items: { type: 'string' } },
        cwd: { type: 'string' },
        timeoutMs: { type: 'integer' },
        shell: { type: 'boolean' },
      },
      required: [],
    },
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

  /** Split a command line into argv, shell-free. */
  function parseArgv(command) {
    const out = [];
    const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g;
    let m;
    while ((m = re.exec(String(command))) !== null) {
      out.push(m[1] !== undefined ? m[1].replace(/\\(["\\])/g, '$1') : (m[2] !== undefined ? m[2] : m[3]));
    }
    return out;
  }

  const engines = {
    async term_execute({ command, argv, cwd, timeoutMs, shell }, ctx = {}) {
      const root = ctx.root ?? process.cwd();
      const timeout = Number(timeoutMs) || 30000;

      // argv-only when we can: no shell, no profile, no injection surface.
      const argvForm = Array.isArray(argv) && argv.length
        ? argv.map(String)
        : (command && !shell ? parseArgv(command) : null);

      if (useSandbox) {
        const sandbox = sessionSandbox({ root });
        let target;
        if (argvForm && argvForm.length) {
          target = argvForm;
        } else if (shell || !command) {
          // Explicit shell form — still inside the sandbox, never on the host.
          target = ['bash', '-lc', String(command ?? '')];
        } else {
          target = argvForm ?? ['true'];
        }
        const res = await sandbox.run(target, { timeoutMs: timeout, cwd: cwd || '/workspace' });
        return {
          ran: true,
          ok: res.ok,
          command: (command ?? target.join(' ')).slice(0, 500),
          argv: target,
          stdout: res.stdout ?? '',
          stderr: res.stderr ?? '',
          output: res.output ?? '',
          code: res.code ?? null,
          durationMs: res.durationMs ?? 0,
          // JEXI-001/JEXI-011 — the receipt says what actually happened.
          sandbox: { backend: res.backend, degraded: res.degraded, isolation: res.isolation, ...sandbox.describe() },
          ...(res.error ? { error: res.error } : {}),
        };
      }

      // Opt-out path (tests, trusted internal callers): host, argv-only.
      const argvOnly = argvForm ?? ['bash', '-lc', String(command ?? '')];
      const res = await runNativeCommand(argvOnly[0], argvOnly.slice(1), { timeoutMs: timeout, cwd: cwd ?? root, displayCmd: command });
      return {
        ran: res.ok, ok: res.ok, command, argv: argvOnly,
        stdout: res.stdout ?? '', stderr: res.stderr ?? '', output: res.output ?? '',
        code: res.code ?? null, durationMs: res.durationMs ?? 0,
        sandbox: { backend: 'host', degraded: true, isolation: 'none', honest: 'sandbox disabled for this call' },
        ...(res.error ? { error: res.error } : {}),
      };
    },

    async term_session({ action, input }, ctx = {}) {
      const owner = ctx.owner ?? 'term-session';
      const cwd = ctx.root ?? process.cwd();
      if (action === 'start') {
        const sandbox = sessionSandbox({ root: cwd });
        const res = await sandbox.run(['/bin/sh', '-c', 'echo session-ready && pwd'], { timeoutMs: 10000 });
        return { ok: res.ok, session: owner, output: res.output, code: res.code, sandbox: { backend: res.backend, degraded: res.degraded } };
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

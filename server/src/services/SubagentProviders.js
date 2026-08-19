/**
 * B138 — SUBAGENT PROVIDERS (DeepSeek Harness `packages/subagent/subagent-claude-code`
 * + `subagent-codex` + `subagent-acp` + `subagent-dsh-sdk` mirror, JEXI-branded).
 *
 * External one-shot subagent providers: JEXI can delegate a task to a REAL
 * external CLI agent when one is installed on the host —
 *
 *   claude-code  → `claude -p <task> --output-format text` (Claude Code CLI)
 *   codex        → `codex exec <task>`                     (Codex CLI)
 *   acp          → `acp <task>`                             (ACP CLI)
 *   dsh-sdk      → in-process fallback (JEXI's own loop)    (always available)
 *   in-process   → JEXI's native subagent runtime           (always available)
 *
 * FAIL-OPEN: a provider whose binary is missing is reported unavailable and
 * the caller falls back to in-process — a missing CLI never fails a turn.
 * Output is bounded (64 KB), the child is tree-killed on timeout, and the
 * environment is the scrubbed JEXI shell env (no secrets leak to the child).
 */

import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import { shellEnv } from './ShellEnv.js';
import { WORKSPACE_DIR } from '../config.js';

const MAX_OUTPUT_CHARS = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 120000;

/** Provider dialect definitions. */
export const SUBAGENT_PROVIDERS = {
  'claude-code': {
    name: 'Claude Code',
    binary: 'claude',
    args: (task) => ['-p', task, '--output-format', 'text'],
    note: 'Spawns the Claude Code CLI in print mode.',
  },
  codex: {
    name: 'Codex',
    binary: 'codex',
    args: (task) => ['exec', task],
    note: 'Spawns the Codex CLI in one-shot exec mode.',
  },
  acp: {
    name: 'ACP',
    binary: 'acp',
    args: (task) => [task],
    note: 'Spawns the ACP CLI in one-shot mode.',
  },
  'dsh-sdk': {
    name: 'DSH SDK (in-process)',
    binary: null,
    inProcess: true,
    note: 'Resolves to JEXI\u2019s own in-process subagent loop.',
  },
  'in-process': {
    name: 'In-process',
    binary: null,
    inProcess: true,
    note: 'JEXI\u2019s native subagent runtime (default).',
  },
};

/** Whether a provider runs an external binary. */
export function isExternalProvider(provider) {
  const spec = SUBAGENT_PROVIDERS[String(provider || '')];
  return !!spec && !spec.inProcess;
}

/** Probe whether a binary exists on PATH. */
export function binaryAvailable(binary) {
  if (!binary) return false;
  try {
    const pathDirs = String(process.env.PATH || '').split(':');
    for (const dir of pathDirs) {
      if (!dir) continue;
      for (const cand of [binary, binary + '.cmd', binary + '.exe']) {
        try {
          if (fs.existsSync(`${dir}/${cand}`)) return true;
        } catch { /* noop */ }
      }
    }
    return false;
  } catch { return false; }
}

/** Availability status of every provider. */
export function subagentProviderStatus() {
  return Object.entries(SUBAGENT_PROVIDERS).map(([key, spec]) => ({
    key,
    name: spec.name,
    available: spec.inProcess ? true : binaryAvailable(spec.binary),
    binary: spec.binary,
    note: spec.note,
  }));
}

/** Resolve the effective provider key (unknown → in-process). */
export function resolveSubagentProvider(provider) {
  const key = String(provider || '').trim() || 'in-process';
  return SUBAGENT_PROVIDERS[key] ? key : 'in-process';
}

/**
 * Run ONE task through an external CLI provider.
 * @param {object} o { provider, task, cwd?, timeoutMs?, signal?, env? }
 * @returns {Promise<{ok, provider, output, code, durationMs, error?}>}
 */
export function runExternalSubagent({ provider, task, cwd = WORKSPACE_DIR, timeoutMs = DEFAULT_TIMEOUT_MS, signal, env = {} } = {}) {
  const key = resolveSubagentProvider(provider);
  const spec = SUBAGENT_PROVIDERS[key];
  if (!spec || spec.inProcess) {
    return Promise.resolve({ ok: false, provider: key, error: `provider "${key}" is not an external CLI provider` });
  }
  if (!binaryAvailable(spec.binary)) {
    return Promise.resolve({ ok: false, provider: key, error: `provider "${key}" is unavailable — binary "${spec.binary}" not found on PATH. Use the in-process provider instead.` });
  }
  const taskText = String(task || '').trim();
  if (!taskText) return Promise.resolve({ ok: false, provider: key, error: 'task required' });

  return new Promise((resolve) => {
    const started = Date.now();
    const id = `ext-${crypto.randomUUID().slice(0, 10)}`;
    let child;
    try {
      child = spawn(spec.binary, spec.args(taskText), {
        cwd: String(cwd || WORKSPACE_DIR || process.cwd()),
        env: shellEnv({ extra: env, convId: `subagent-${id}` }),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      resolve({ ok: false, provider: key, error: `spawn failed: ${(e && e.message) || e}`, durationMs: Date.now() - started });
      return;
    }
    let stdout = '';
    let stderr = '';
    const push = (buf, isErr) => {
      const chunk = buf.toString('utf8');
      if (isErr) stderr = (stderr + chunk).slice(-MAX_OUTPUT_CHARS);
      else stdout = (stdout + chunk).slice(-MAX_OUTPUT_CHARS);
    };
    child.stdout.on('data', (d) => push(d, false));
    child.stderr.on('data', (d) => push(d, true));
    const onAbort = () => { try { child.kill('SIGKILL'); } catch { /* noop */ } };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* noop */ } }, timeoutMs);
    const settle = (code) => {
      clearTimeout(timer);
      const durationMs = Date.now() - started;
      const output = (stdout || stderr).trim();
      const ok = code === 0;
      const out = { ok, provider: key, output: output.slice(0, MAX_OUTPUT_CHARS), code, durationMs };
      if (!ok) out.error = (stderr || `provider exited ${code}`).trim().slice(0, 2000);
      resolve(out);
    };
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, provider: key, error: `spawn error: ${(e && e.message) || e}`, durationMs: Date.now() - started });
    });
    child.on('close', settle);
  });
}

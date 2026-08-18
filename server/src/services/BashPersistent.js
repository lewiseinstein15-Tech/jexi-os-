/**
 * B135 — PERSISTENT BASH (DeepSeek Harness `packages/shell/tool-bash-persistent`
 * mirror).
 *
 * Model-facing persistent `bash`: one long-running interactive shell per
 * OWNER (conversation id). State — including the current directory and
 * exported environment variables — persists across calls. Commands run
 * marker-wrapped so the result is parsed deterministically:
 *
 *   printf '%s\n' '__JEXI_BASH_START_<nonce>__'
 *   eval -- '<quoted command>'; __jexi_status=$?
 *   printf '%s%s\n' '__JEXI_BASH_END_<nonce>:' "$__jexi_status"
 *
 * Truncation and reset notes mirror DSH verbatim so the model knows when
 * output was clipped or the shell was recreated. On timeout the command is
 * left running and the call returns PERSISTENT_BASH_TIMEOUT (the next call
 * sees the straggler output before its own marker block).
 */

import { spawn } from 'child_process';
import crypto from 'crypto';
import { WORKSPACE_DIR } from '../config.js';

const SHELL_PROMPT = ''; // PS1 is cleared; leftover prompts are stripped defensively
const TRUNCATED_MESSAGE = '<response clipped><NOTE>To save on context only part of this file has been shown to you. You should retry this tool after you have searched inside the file with `grep -n` in order to find the line numbers of what you are looking for.</NOTE>';
const LOST_PREFIX_MESSAGE = '<response clipped><NOTE>The beginning of this command output was dropped by the shell scrollback limit. The following text is the earliest retained output.</NOTE>\n';
const SHELL_RESET_MESSAGE = 'The persistent bash shell was reset; the next bash call starts from the workspace with a fresh current directory and environment.';
const TIMEOUT_CODE = 'PERSISTENT_BASH_TIMEOUT';
const SCROLLBACK_MAX = 256 * 1024;
const POLL_INTERVAL_MS = 25;
const MAX_SHELLS = 16;

const shells = new Map(); // owner → { child, buffer, born, cwd }

function ownerKey(owner) { return String(owner || 'default').slice(0, 64); }

function quoteForBash(value) {
  return `$'${String(value)
    .replaceAll('\\', '\\\\')
    .replaceAll("'", "\\'")
    .replaceAll('\r', '\\r')
    .replaceAll('\n', '\\n')}'`;
}

function markers() {
  const nonce = crypto.randomUUID().slice(0, 12);
  return { start: `__JEXI_BASH_START_${nonce}__`, end: `__JEXI_BASH_END_${nonce}:` };
}

function wrapCommand(command, marker) {
  return `printf '%s\\n' ${quoteForBash(marker.start)}; eval -- ${quoteForBash(command)}; __jexi_status=$?; printf '%s%s\\n' ${quoteForBash(marker.end)} "$__jexi_status"`;
}

function stripPrompt(text) {
  let result = String(text || '').replace(/\r?\n$/, '');
  while (result.endsWith('$ ') || result.endsWith('# ') || result.endsWith('> ')) {
    result = result.slice(0, -2);
  }
  return result.endsWith('\n') ? result.slice(0, -1) : result;
}

function commandOutput(snapshotText, marker) {
  const text = String(snapshotText || '');
  // The interactive shell ECHOES the raw command line back after executing it
  // (including the marker text), so the LAST marker occurrence is the echo,
  // not the real printf output. Scan every occurrence and accept the last one
  // whose suffix is exactly `<digits><newline>` — the real one always is.
  let end = -1;
  let statusMatch = null;
  for (let i = text.indexOf(marker.end); i >= 0; i = text.indexOf(marker.end, i + 1)) {
    const m = /^(\d+)\r?\n/.exec(text.slice(i + marker.end.length));
    if (m) { end = i; statusMatch = m; }
  }
  if (end < 0 || !statusMatch) return undefined;
  const startMarker = text.lastIndexOf(marker.start, end);
  const start = startMarker < 0 ? 0 : startMarker + marker.start.length;
  return {
    text: stripPrompt(text.slice(start, end).replace(/^\r?\n/, '')),
    incomplete: startMarker < 0,
    exitCode: Number(statusMatch[1]),
  };
}

/** Get (or create) the persistent shell for an owner. */
export function getShell(owner, { cwd } = {}) {
  const key = ownerKey(owner);
  const existing = shells.get(key);
  if (existing && !existing.child.exitCode && !existing.closed) return existing;
  if (existing) shells.delete(key);
  if (shells.size >= MAX_SHELLS) {
    // evict the oldest
    const oldest = [...shells.entries()].sort((a, b) => a[1].born - b[1].born)[0];
    if (oldest) { try { oldest[1].child.kill('SIGTERM'); } catch { /* noop */ } shells.delete(oldest[0]); }
  }
  const child = spawn('/bin/bash', ['-i'], {
    cwd: String(cwd || WORKSPACE_DIR || process.cwd()),
    env: { ...process.env, TERM: 'dumb', PS1: '', PROMPT_COMMAND: '' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const rec = { child, buffer: '', born: Date.now(), closed: false, cwd: String(cwd || WORKSPACE_DIR || process.cwd()) };
  const push = (chunk) => {
    rec.buffer = (rec.buffer + chunk.toString('utf8')).slice(-SCROLLBACK_MAX);
  };
  child.stdout.on('data', push);
  child.stderr.on('data', push);
  child.on('exit', () => { rec.closed = true; });
  child.on('error', () => { rec.closed = true; });
  shells.set(key, rec);
  return rec;
}

/** Reset an owner's shell (SHELL_RESET_MESSAGE is prepended to next output). */
export function resetShell(owner, reason = 'requested') {
  const key = ownerKey(owner);
  const rec = shells.get(key);
  let note = SHELL_RESET_MESSAGE;
  if (rec) {
    try { rec.child.kill('SIGTERM'); } catch { /* noop */ }
    shells.delete(key);
  }
  if (reason) note = `${note} (${reason})`;
  return { ok: true, note };
}

/** Live shell status for diagnostics. */
export function listPersistentShells() {
  return [...shells.entries()].map(([owner, rec]) => ({
    owner,
    ageMs: Date.now() - rec.born,
    bufferBytes: Buffer.byteLength(rec.buffer),
    alive: !rec.closed,
  }));
}

function maybeTruncate(content, maxChars) {
  if (content.length <= maxChars) return { text: content, truncated: false };
  return { text: content.slice(0, maxChars) + TRUNCATED_MESSAGE, truncated: true };
}

/**
 * Run one command in the owner's persistent shell.
 * @param {object} params { owner, command, timeoutMs?, maxOutputChars?, cwd?, reset? }
 * @returns {Promise<{ok, kind, command, output, code, durationMs, truncated?, reset?, error?}>}
 */
export async function runPersistentBash({ owner, command, timeoutMs = 30000, maxOutputChars = 12000, cwd, reset = false }) {
  const started = Date.now();
  const cmd = String(command || '').trim();
  if (!cmd) return { ok: false, error: 'command required', durationMs: 0 };
  const key = ownerKey(owner);

  let resetNote = '';
  if (reset) {
    resetNote = resetShell(key, 'requested reset').note;
  }
  let rec = shells.get(key);
  if (!rec || rec.closed) {
    rec = getShell(key, { cwd });
    resetNote = resetNote || SHELL_RESET_MESSAGE;
  }
  if (rec.closed || !rec.child.stdin.writable) {
    rec = getShell(key, { cwd });
    resetNote = resetNote || SHELL_RESET_MESSAGE;
  }

  const timeout = Math.min(Math.max(Number(timeoutMs) || 30000, 1000), 120000);
  const marker = markers();
  const prefix = cwd && !reset ? `cd ${quoteForBash(String(cwd))} 2>/dev/null; ` : '';
  const line = wrapCommand(prefix + cmd, marker);

  // Snapshot the scrollback position BEFORE this command so only new output is parsed.
  const beforeLen = rec.buffer.length;

  try {
    rec.child.stdin.write(line + '\n');
  } catch (e) {
    return { ok: false, error: `write failed: ${(e && e.message) || e}`, durationMs: Date.now() - started };
  }

  const deadline = Date.now() + timeout;
  let parsed;
  for (;;) {
    parsed = commandOutput(rec.buffer.slice(beforeLen), marker);
    if (parsed) break;
    if (rec.closed) break;
    if (Date.now() > deadline) break;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  const durationMs = Date.now() - started;

  if (!parsed) {
    if (rec.closed) {
      resetShell(key, 'shell exited');
      return {
        ok: false,
        kind: 'bash-result',
        command: cmd.slice(0, 300),
        output: resetNote + '\n' + rec.buffer.slice(-4000),
        code: null,
        durationMs,
        error: 'PERSISTENT_BASH_SHELL_EXITED: the persistent bash shell exited; it was reset for the next call.',
      };
    }
    const partial = rec.buffer.slice(beforeLen).slice(-4000);
    return {
      ok: false,
      kind: 'bash-result',
      command: cmd.slice(0, 300),
      output: partial || '',
      code: null,
      durationMs,
      error: `${TIMEOUT_CODE}: the command did not finish within ${timeout}ms. It is still running in the shell; drain it with a follow-up command or reset the shell.`,
    };
  }

  let text = parsed.text;
  let truncated = parsed.incomplete;
  if (parsed.incomplete) text = LOST_PREFIX_MESSAGE + text;
  const clipped = maybeTruncate(text, maxOutputChars);
  text = clipped.text;
  truncated = truncated || clipped.truncated;

  // Drain the consumed prefix so buffer stays bounded per owner.
  rec.buffer = rec.buffer.slice(beforeLen);

  const out = {
    ok: parsed.exitCode === 0,
    kind: 'bash-result',
    command: cmd.slice(0, 300),
    output: text,
    code: parsed.exitCode,
    durationMs,
    ...(resetNote ? { reset: resetNote } : {}),
    ...(truncated ? { truncated: true } : {}),
  };
  return out;
}

/** Close every persistent shell (shutdown). */
export function closeAllShells() {
  for (const [, rec] of shells) { try { rec.child.kill('SIGTERM'); } catch { /* noop */ } }
  shells.clear();
}

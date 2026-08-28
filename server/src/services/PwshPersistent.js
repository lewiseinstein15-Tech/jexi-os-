/**
 * B160 — PERSISTENT POWERSHELL (DeepSeek Harness
 * `packages/shell/tool-pwsh-persistent` mirror).
 *
 * Model-facing owner-scoped persistent `pwsh` tool backed by one long-running
 * PowerShell process per OWNER (conversation id). Mirrors the persistent-bash
 * design: marker-wrapped commands parsed deterministically, scrollback cap,
 * truncation notes, reset semantics, PERSISTENT_PWSH_TIMEOUT on timeout.
 *
 * Graceful where PowerShell doesn't exist (Linux CI, Render free tier):
 * `pwshAvailable()` probes once; every call then returns a deterministic,
 * model-readable unavailable result instead of throwing.
 *
 * Grammar differences from bash, mirrored from DSH's tool:
 *   - markers printed with Write-Output
 *   - exit status via $LASTEXITCODE (native) / 0 (pure cmdlet success)
 *   - quoting: single-quoted PS strings with '' escaping
 */

import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { WORKSPACE_DIR } from '../config.js';
import { shellEnv } from './ShellEnv.js';

const TRUNCATED_MESSAGE = '<response clipped><NOTE>To save on context only part of this file has been shown to you. You should retry this tool after you have searched inside the file with `Select-String -LineNumbers` in order to find the line numbers of what you are looking for.</NOTE>';
const SHELL_RESET_MESSAGE = 'The persistent pwsh shell was reset; the next pwsh call starts from the workspace with a fresh current directory and environment.';
const TIMEOUT_CODE = 'PERSISTENT_PWSH_TIMEOUT';
const UNAVAILABLE_CODE = 'PERSISTENT_PWSH_UNAVAILABLE';
const SCROLLBACK_MAX = 256 * 1024;
const POLL_INTERVAL_MS = 25;
const MAX_SHELLS = 8;

const shells = new Map(); // owner → { child, buffer, born, closed }

let pwshBinary = undefined; // undefined = not probed, null = missing, string = path

/** Synchronously resolve an executable on PATH (spawn's missing-binary error
 *  is ASYNC — an optimistic spawn probe always lies). */
function resolveOnPath(bin) {
  try {
    if (bin.includes('/') || bin.includes('\\')) return fs.existsSync(bin) ? bin : null;
    const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
    for (const dir of (process.env.PATH || '').split(path.delimiter)) {
      if (!dir) continue;
      for (const ext of exts) {
        const full = path.join(dir, bin + ext);
        try { if (fs.statSync(full).isFile()) return full; } catch { /* keep scanning */ }
      }
    }
  } catch { /* fallthrough */ }
  return null;
}

/** Probe for a usable PowerShell once (pwsh on PATH; Windows also checks powershell.exe). */
export function pwshAvailable() {
  if (pwshBinary !== undefined) return pwshBinary;
  const candidates = process.platform === 'win32' ? ['powershell.exe', 'pwsh.exe'] : ['pwsh'];
  for (const bin of candidates) {
    const full = resolveOnPath(bin);
    if (full) { pwshBinary = full; return pwshBinary; }
  }
  pwshBinary = null;
  return null;
}

function ownerKey(owner) { return String(owner || 'default').slice(0, 64); }

function quoteForPwsh(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function markers() {
  const nonce = crypto.randomUUID().slice(0, 12);
  return { start: `__JEXI_PWSH_START_${nonce}__`, end: `__JEXI_PWSH_END_${nonce}:` };
}

function wrapCommand(command, marker) {
  return [
    `Write-Output ${quoteForPwsh(marker.start)}`,
    `${command}`,
    `Write-Output (${quoteForPwsh(marker.end)} + $([int]$(if ($LASTEXITCODE -ne $null) { $LASTEXITCODE } else { 0 })))`,
  ].join('\n');
}

function commandOutput(text, marker) {
  const buf = String(text || '');
  const endIdx = buf.lastIndexOf(marker.end);
  if (endIdx < 0) return undefined;
  const m = /^(\d+)\r?\n?/.exec(buf.slice(endIdx + marker.end.length));
  if (!m) return undefined;
  const startMarker = buf.lastIndexOf(marker.start, endIdx);
  const start = startMarker < 0 ? 0 : startMarker + marker.start.length;
  return {
    text: buf.slice(start, endIdx).replace(/^\r?\n/, '').replace(/\r?$/, ''),
    incomplete: startMarker < 0,
    exitCode: Number(m[1]),
  };
}

/** Get (or create) the persistent pwsh process for an owner. */
export function getPwsh(owner, { cwd } = {}) {
  const bin = pwshAvailable();
  if (!bin) return null;
  const key = ownerKey(owner);
  const existing = shells.get(key);
  if (existing && !existing.closed) return existing;
  if (existing) shells.delete(key);
  if (shells.size >= MAX_SHELLS) {
    const oldest = [...shells.entries()].sort((a, b) => a[1].born - a[1].born)[0];
    if (oldest) { try { oldest[1].child.kill(); } catch { /* noop */ } shells.delete(oldest[0]); }
  }
  const child = spawn(bin, ['-NoLogo', '-NoProfile', '-NoExit', '-Command', '-'], {
    cwd: String(cwd || WORKSPACE_DIR || process.cwd()),
    env: { ...shellEnv({ convId: owner }) },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const rec = { child, buffer: '', born: Date.now(), closed: false };
  const push = (chunk) => { rec.buffer = (rec.buffer + chunk.toString('utf8')).slice(-SCROLLBACK_MAX); };
  child.stdout.on('data', push);
  child.stderr.on('data', push);
  child.on('exit', () => { rec.closed = true; });
  child.on('error', () => { rec.closed = true; });
  shells.set(key, rec);
  return rec;
}

/** Reset an owner's pwsh (SHELL_RESET_MESSAGE semantics). */
export function resetPwsh(owner, reason = 'requested') {
  const key = ownerKey(owner);
  const rec = shells.get(key);
  let note = SHELL_RESET_MESSAGE;
  if (rec) {
    try { rec.child.kill(); } catch { /* noop */ }
    shells.delete(key);
  }
  if (reason) note = `${note} (${reason})`;
  return { ok: true, note };
}

export function listPersistentPwsh() {
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
 * Execute one command in the owner's persistent pwsh. Result shape mirrors
 * the persistent-bash tool: { ok, kind, output, exitCode, truncated?, note? }.
 */
export async function runPwsh(owner, command, { timeoutMs = 60000, maxChars = 24000 } = {}) {
  const bin = pwshAvailable();
  if (!bin) {
    return { ok: false, kind: 'pwsh', code: UNAVAILABLE_CODE, output: 'PowerShell (pwsh) is not installed on this host — use the persistent bash tool instead.' };
  }
  const rec = getPwsh(owner);
  const marker = markers();
  const prior = rec.buffer;
  rec.buffer = '';
  rec.child.stdin.write(wrapCommand(String(command || ''), marker) + '\n');

  const deadline = Date.now() + Math.max(1000, timeoutMs);
  while (Date.now() < deadline) {
    const parsed = commandOutput(rec.buffer, marker);
    if (parsed) {
      const lostPrefix = prior.includes(marker.start) ? 1 : 0;
      const { text, truncated } = maybeTruncate(parsed.text, maxChars);
      return {
        ok: parsed.exitCode === 0,
        kind: 'pwsh',
        output: (lostPrefix ? '<response clipped>' : '') + text,
        exitCode: parsed.exitCode,
        ...(truncated ? { truncated: true } : {}),
      };
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return {
    ok: false,
    kind: 'pwsh',
    code: TIMEOUT_CODE,
    output: `The command did not finish within ${timeoutMs} ms and is still running in the persistent shell; its straggler output will precede the next pwsh result.`,
  };
}

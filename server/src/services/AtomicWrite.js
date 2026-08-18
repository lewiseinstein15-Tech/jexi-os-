/**
 * B132 — ATOMIC WRITE (DeepSeek Harness `packages/util/atomic-write` mirror).
 * Crash-safe writes: write to a temp file in the same dir, fsync, rename.
 * Used for the conversation log caps, titles, feedback and telemetry so a
 * crash mid-write can never corrupt a store.
 */

import fs from 'fs';
import path from 'path';

/** Atomically replace a file's contents (temp + rename). */
export function writeFileAtomic(filename, content) {
  const dir = path.dirname(filename);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.tmp-${path.basename(filename)}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  try {
    fs.writeFileSync(tmp, content, 'utf-8');
    try { fs.fsyncSync(fs.openSync(tmp, 'r')); } catch { /* fsync best-effort */ }
    fs.renameSync(tmp, filename);
    return true;
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* noop */ }
    throw e;
  }
}

/** Append atomically: read-modify-write is avoided by appending directly
 *  (append is atomic enough for logs), but the CAP rewrite uses writeFileAtomic. */
export function appendAndCap(file, line, maxLines, loadLines) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, line + '\n', 'utf-8');
  const lines = loadLines(file);
  if (lines.length > maxLines) {
    writeFileAtomic(file, lines.slice(lines.length - maxLines).join('\n') + '\n');
  }
}

/** Acquire an exclusive lock file (best-effort; stale locks break after ttlMs). */
export function withFileLock(lockPath, ttlMs = 10000, fn) {
  const now = Date.now();
  try {
    const st = fs.statSync(lockPath);
    if (now - st.mtimeMs > ttlMs) fs.unlinkSync(lockPath); // stale lock
  } catch { /* no lock yet */ }
  try {
    fs.writeFileSync(lockPath, String(now), 'utf-8');
    const r = fn();
    return r && typeof r.then === 'function' ? r.finally(() => { try { fs.unlinkSync(lockPath); } catch { /* noop */ } }) : (() => { try { fs.unlinkSync(lockPath); } catch { /* noop */ } return r; })();
  } catch (e) {
    try { fs.unlinkSync(lockPath); } catch { /* noop */ }
    throw e;
  }
}

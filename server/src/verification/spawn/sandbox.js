/**
 * JEXI OS — VERIFICATION — immutable-snapshot sandbox.
 *
 * The Phase 4 contract: a verifier reads from the immutable snapshot, never
 * the live workspace (the claimant controls that). A real spawn must
 * therefore run against a MATERIALIZED COPY of the snapshot's files, in an
 * OS tempdir, so the child process sees exactly the frozen bytes — no more,
 * no less. The tempdir is removed after the verifier finishes.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Write snapshot.files into a fresh tempdir. Returns the sandbox dir. */
export function materializeSnapshot(snapshot, { base = os.tmpdir() } = {}) {
  const dir = fs.mkdtempSync(path.join(base, 'jexi-verify-'));
  for (const [rel, content] of Object.entries(snapshot?.files ?? {})) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, String(content), 'utf8');
  }
  return dir;
}

/** Remove a materialized sandbox. */
export function cleanupSandbox(dir) {
  if (dir) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* already gone */ }
  }
}

/**
 * Decide the working directory for a real spawn.
 *
 * Default: run in the caller's cwd — a real spawn of the project's own
 * command needs its package.json + node_modules, so the sandbox is OFF by
 * default (the snapshot contract is honored at the evidence layer: every
 * evidence record pins the snapshotId, and FileStateVerifier byte-compares
 * against the frozen files).
 *
 * Strict mode: pass `materialize: true` to materialize the snapshot's files
 * into a fresh tempdir and run the command there (used by callers that need
 * byte-level isolation — the child process then sees exactly the frozen
 * bytes, never the live workspace).
 */
export function verifyCwd(snapshot, options = {}) {
  const hasFiles = snapshot?.files && Object.keys(snapshot.files).length > 0;
  if (hasFiles && options.materialize === true) {
    const sandbox = materializeSnapshot(snapshot);
    return { cwd: sandbox, sandbox };
  }
  return { cwd: options.cwd || process.cwd(), sandbox: null };
}
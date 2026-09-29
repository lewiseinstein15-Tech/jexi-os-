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
 * JEXI-007 — materialize by DEFAULT. It used to be opt-in:
 *
 *     if (hasFiles && options.materialize === true) { ... }
 *     return { cwd: options.cwd || process.cwd(), sandbox: null };
 *
 * so the default for TestVerifier was the LIVE workspace — the one directory
 * the claimant (the thing being verified) controls. A claimant could edit
 * files between the snapshot being taken and the verifier reading them, and
 * the "immutable snapshot contract" this module exists to enforce was opt-in
 * rather than the default.
 *
 * Now, whenever the snapshot actually carries files, they are materialized
 * into a fresh tempdir and the command runs THERE. Running against the live
 * cwd is an explicit opt-out (`materialize: false`), for the real cases that
 * need node_modules or a venv a snapshot cannot carry.
 *
 *   materialize (default)  → tempdir holding the frozen bytes
 *   materialize:false      → live cwd (documented opt-out)
 *   no files in snapshot   → live cwd (nothing to materialize)
 */
export function verifyCwd(snapshot, options = {}) {
  const hasFiles = snapshot?.files && Object.keys(snapshot.files).length > 0;
  const { materialize } = options;

  // No files to freeze — there is nothing a claimant could tamper with.
  if (!hasFiles) {
    return { cwd: options.cwd || process.cwd(), sandbox: null, materialized: false, reason: 'snapshot carries no files' };
  }

  // Explicit opt-out, but ONLY when the caller says so and gave a cwd to use.
  if (materialize === false && options.cwd) {
    return { cwd: options.cwd, sandbox: null, materialized: false, reason: 'explicit opt-out (materialize:false) — live workspace' };
  }

  const sandbox = materializeSnapshot(snapshot);
  return { cwd: sandbox, sandbox, materialized: true, reason: 'materialized from immutable snapshot' };
}
/**
 * JEXI OS — tools — path confinement.
 *
 * One authority for "may this path be touched?", shared by the filesystem
 * domain, the terminal domain and the verification sandbox.
 *
 * WHY THIS EXISTS (JEXI-005): the old check was
 *
 *     const full = path.resolve(root, p);
 *     if (!full.startsWith(path.resolve(root))) throw new Error('path escapes root');
 *
 * `startsWith` compares STRINGS, not paths, so it has no idea where one path
 * stops and the next begins. With root `/tmp/a`, the sibling directory
 * `/tmp/ab` — a completely different tree — starts with `/tmp/a` and sailed
 * straight through. The fix is a segment-boundary check, and a realpath pass
 * so a symlink cannot step outside after the check passed.
 *
 * The check is a pure function of (root, p) with no I/O unless
 * `followSymlinks` is on, so it is trivially testable — see
 * tests/tickets/jexi-005-path-confinement.test.js.
 */

import fs from 'node:fs';
import path from 'node:path';

export class PathEscapeError extends Error {
  constructor(message, detail = {}) {
    super(message);
    this.name = 'PathEscapeError';
    this.code = 'E_PATH_ESCAPE';
    Object.assign(this, detail);
  }
}

/**
 * True when `full` is `root` itself or lives underneath it.
 *
 * Uses path.relative rather than string prefixing, so `/tmp/a` does NOT
 * contain `/tmp/ab` (relative = '../ab') and the root itself IS contained
 * (relative = '').
 */
export function isWithin(root, full) {
  const rel = path.relative(root, full);
  if (rel === '') return true;              // the root itself
  if (path.isAbsolute(rel)) return false;   // different drive/root entirely
  return !rel.startsWith('..' + path.sep) && rel !== '..';
}

/**
 * The nearest EXISTING ancestor of `p`, with symlinks already resolved.
 *
 * realpathSync throws for a path that does not exist yet, and an edit tool has
 * to validate paths it is about to CREATE. So we walk up until something
 * exists, resolve that, and re-append the unresolved tail.
 */
function realpathOfNearestExisting(p) {
  let probe = p;
  const tail = [];
  // bounded: a real path is never more segments than the input
  for (let i = 0; i < 4096; i++) {
    try {
      const real = fs.realpathSync(probe);
      return tail.length ? path.join(real, ...tail.reverse()) : real;
    } catch {
      const parent = path.dirname(probe);
      if (parent === probe) return p; // hit the filesystem root, give up
      tail.push(path.basename(probe));
      probe = parent;
    }
  }
  return p;
}

/**
 * Resolve `p` inside `root`, or throw PathEscapeError.
 *
 * @param {string} root   the confinement root (absolute or cwd-relative)
 * @param {string} p      the caller-supplied path
 * @param {object} [opts]
 * @param {boolean} [opts.followSymlinks=true] resolve symlinks before checking
 * @param {boolean} [opts.mustExist=false]    also require the target to exist
 * @returns {string} the absolute, confined path
 */
export function resolveWithin(root, p, opts = {}) {
  const { followSymlinks = true, mustExist = false } = opts;
  const absRoot = path.resolve(root);
  const raw = String(p ?? '');
  // A NUL byte in a path is a truncation attempt, not a path.
  if (raw.includes('\0')) throw new PathEscapeError('path contains a NUL byte', { input: raw });
  const resolved = path.resolve(absRoot, raw);

  if (!isWithin(absRoot, resolved)) {
    throw new PathEscapeError(`path escapes root: ${raw}`, { root: absRoot, resolved, input: raw });
  }

  if (followSymlinks) {
    // Resolve the REAL location of both sides. Comparing resolved-to-resolved
    // is what catches a symlink INSIDE the root that points outside it, and a
    // symlinked root that really lives somewhere else.
    const realRoot = realpathOfNearestExisting(absRoot);
    const realTarget = realpathOfNearestExisting(resolved);
    if (!isWithin(realRoot, realTarget)) {
      throw new PathEscapeError(`path escapes root via symlink: ${raw}`, {
        root: absRoot, realRoot, realTarget, input: raw, symlink: true,
      });
    }
  }

  if (mustExist && !fs.existsSync(resolved)) {
    const e = new Error(`ENOENT: no such file or directory: ${resolved}`);
    e.code = 'ENOENT';
    throw e;
  }
  return resolved;
}

/** True when `p` may be touched inside `root`. Never throws. */
export function safeResolveWithin(root, p, opts = {}) {
  try { resolveWithin(root, p, opts); return true; } catch { return false; }
}

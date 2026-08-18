/**
 * B136 — FS SANDBOX (DeepSeek Harness `packages/fs/fs-sandbox` mirror,
 * JEXI-branded).
 *
 * In-process filesystem containment: decide whether a filesystem operation is
 * inside the allowed roots for the session's sandbox mode. FAIL-CLOSED — a
 * path that cannot be proven inside the workspace is refused for writes.
 *
 *   checkFsOperation({ op: 'read'|'write'|'edit'|'list'|'delete',
 *                      target, workspaceRoot, mode, extraRoots? })
 *     → { allowed, reason? }
 *
 * Containment mechanics mirror dsh containment.ts: the lexical fast path
 * (canonical prefix) plus the filesystem-identity fallback (dev/ino walk) for
 * alias spellings. Modes mirror sandbox-policy: read-only → reads only;
 * workspace-write → writes inside the workspace only; danger-full-access →
 * everything allowed (approval gates still apply upstream).
 */

import fs from 'fs';
import path from 'path';
import { sandboxTempDir } from './SandboxLocal.js';

const MISSING_CODES = new Set(['ENOENT', 'ENOTDIR']);

function isLexicallyUnder(target, root) {
  if (target === root) return true;
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  return target.startsWith(prefix);
}

function statIfPresent(p) {
  try { return fs.statSync(p, { bigint: true }); } catch (e) {
    if (MISSING_CODES.has(e && e.code)) return undefined;
    throw e;
  }
}

function sameIdentity(a, b) {
  return a.dev === b.dev && a.ino === b.ino;
}

/** Whether a canonical target is a root or lies beneath it (lexical + identity). */
export function isPathUnder(target, root) {
  const targetAbs = path.resolve(String(target || ''));
  const rootAbs = path.resolve(String(root || ''));
  if (isLexicallyUnder(targetAbs, rootAbs)) return true;
  const rootInfo = statIfPresent(rootAbs);
  if (!rootInfo) return false;
  let ancestor = targetAbs;
  for (;;) {
    const info = statIfPresent(ancestor);
    if (info && sameIdentity(info, rootInfo)) return true;
    const parent = path.dirname(ancestor);
    if (parent === ancestor) return false;
    ancestor = parent;
  }
}

/** Mode policy: which ops are allowed outside the workspace root. */
const MODE_RULES = {
  'read-only': { writeOps: false, outsideReads: false },
  'workspace-write': { writeOps: true, outsideReads: false },
  'danger-full-access': { writeOps: true, outsideReads: true },
};

const WRITE_OPS = new Set(['write', 'edit', 'delete', 'rename', 'mkdir']);

/**
 * Fail-closed filesystem gate.
 * @param {object} o { op, target, workspaceRoot, mode, extraRoots? }
 */
export function checkFsOperation({ op, target, workspaceRoot, mode = 'workspace-write', extraRoots = [] } = {}) {
  const t = String(target || '');
  if (!t) return { allowed: false, reason: 'no target path' };
  const opName = String(op || 'read');
  const rules = MODE_RULES[mode] || MODE_RULES['workspace-write'];

  // Reads are always allowed inside the workspace; outside reads depend on mode.
  const inside = isPathUnder(t, workspaceRoot) || extraRoots.some((r) => isPathUnder(t, r));
  if (inside) {
    if (WRITE_OPS.has(opName) && !rules.writeOps) {
      return { allowed: false, reason: `Current sandbox mode is ${mode}: no writes.` };
    }
    return { allowed: true };
  }
  if (!WRITE_OPS.has(opName) && rules.outsideReads) return { allowed: true };
  if (!WRITE_OPS.has(opName) && mode === 'read-only') {
    // read-only mode: outside reads are refused too (nothing outside is trusted).
    return { allowed: false, reason: `Current sandbox mode is read-only: only workspace reads are allowed.` };
  }
  return {
    allowed: false,
    reason: `${opName} of "${t}" is outside the workspace (${workspaceRoot}) in sandbox mode ${mode}. Refusing to fail-closed.`,
  };
}

/** Effective roots for one session (workspace + private temp). */
export function effectiveFsRoots({ workspaceRoot, convId = null } = {}) {
  const roots = [path.resolve(workspaceRoot || process.cwd())];
  if (convId) {
    try {
      const t = sandboxTempDir(convId);
      if (t.ok) roots.push(t.dir);
    } catch { /* noop */ }
  }
  return roots;
}

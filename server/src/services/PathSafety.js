/**
 * JEXI OS — Path Safety (security hardening).
 *
 * Single source of truth for "is this name safe to touch inside a root
 * directory?" Used by the file-preview routes (/api/files, /preview), the
 * workspace writers (Orchestrator /guard, ComputerUseAgent, Runner) so one
 * check protects all of them:
 *
 *   resolveInside()     — resolves a name inside a root, throwing on any
 *                         attempt to escape (.. segments, absolute paths,
 *                         NUL bytes). Lexical resolution: a rejected name
 *                         can never read/write outside the root.
 *   isInside()          — throw-safe boolean wrapper.
 *   isShellSafeFileName — single file name usable as ONE shell argument
 *                         (no separators, no metacharacters, no leading
 *                         dash, no path segments).
 */

import path from 'path';

/** Resolve `name` inside `root`, or throw when it would escape the root. */
export function resolveInside(root, name) {
  const clean = String(name == null ? '' : name);
  if (!clean || clean.includes('\0')) throw new Error(`Unsafe path: ${String(name)}`);
  if (clean.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(clean)) {
    throw new Error(`Unsafe path (absolute): ${String(name)}`);
  }
  const rootResolved = path.resolve(root);
  const target = path.resolve(rootResolved, clean);
  if (target !== rootResolved && !target.startsWith(rootResolved + path.sep)) {
    throw new Error(`Path escapes ${rootResolved}: ${String(name)}`);
  }
  return target;
}

/** Boolean variant — true when the name stays inside the root. */
export function isInside(root, name) {
  try {
    resolveInside(root, name);
    return true;
  } catch {
    return false;
  }
}

/**
 * A single file name that is safe to pass as one argv element to a child
 * process: no path separators, no '..', no leading dash (flag injection),
 * no shell metacharacters, no control characters.
 */
export function isShellSafeFileName(name) {
  const s = String(name == null ? '' : name);
  if (!s || s.length > 200) return false;
  if (s.includes('/') || s.includes('\\') || s.includes('..')) return false;
  if (s.startsWith('-')) return false;
  return /^[\w.\- ]+$/.test(s) && !s.includes('\0');
}

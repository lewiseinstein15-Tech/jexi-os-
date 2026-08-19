/**
 * B139 — DIRECTORY PICKER (DeepSeek Harness `packages/host/directory-picker`
 * + `directory-picker-browse` + `directory-picker-native` mirror,
 * JEXI-branded).
 *
 * Host directory browsing for the client: list subdirectories at a path
 * (depth 1 per call — the client drills down), bounded entries, hidden
 * folders filtered by default, workspace-relative display. Fail-closed on
 * unreadable paths and on traversal outside the allowed root when a root is
 * enforced.
 */

import fs from 'fs';
import path from 'path';
import { WORKSPACE_DIR } from '../config.js';

const MAX_ENTRIES = 200;

/**
 * Browse directories under a path.
 * @param {object} o { base, root?, showHidden?, limit? }
 */
export function browseDirectories({ base = WORKSPACE_DIR, root = null, showHidden = false, limit = MAX_ENTRIES } = {}) {
  const baseAbs = path.resolve(String(base || WORKSPACE_DIR || process.cwd()));
  // Root enforcement: when a root is given, the base must live under it.
  if (root) {
    const rootAbs = path.resolve(String(root));
    const rel = path.relative(rootAbs, baseAbs);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return { ok: false, error: `path "${base}" is outside the allowed root "${rootAbs}"` };
    }
  }
  let entries;
  try {
    entries = fs.readdirSync(baseAbs, { withFileTypes: true });
  } catch (e) {
    return { ok: false, error: `cannot read "${base}": ${(e && e.code) || (e && e.message) || e}` };
  }
  const dirs = entries
    .filter((e) => e.isDirectory() && (showHidden || !e.name.startsWith('.')))
    .map((e) => ({
      name: e.name,
      path: path.join(baseAbs, e.name),
      display: path.relative(root || path.resolve(WORKSPACE_DIR || process.cwd()), path.join(baseAbs, e.name)) || e.name,
      // stat once per entry for a little metadata (best-effort)
      mtimeMs: (() => { try { return fs.statSync(path.join(baseAbs, e.name)).mtimeMs; } catch { return null; } })(),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, Math.max(1, Math.min(Number(limit) || MAX_ENTRIES, MAX_ENTRIES)));

  return {
    ok: true,
    base: baseAbs,
    root: root ? path.resolve(String(root)) : null,
    entries: dirs,
    count: dirs.length,
    truncated: dirs.length >= Math.min(Number(limit) || MAX_ENTRIES, MAX_ENTRIES),
    parent: path.dirname(baseAbs) === baseAbs ? null : path.dirname(baseAbs),
    writable: (() => { try { fs.accessSync(baseAbs, fs.constants.W_OK); return true; } catch { return false; } })(),
  };
}

/** Validate a folder name for authoring operations (no traversal). */
export function validFolderName(name) {
  const n = String(name || '');
  return n.length > 0 && n.length <= 64 && !n.includes('/') && !n.includes('\\') && !n.includes('..') && !/[\0-\x1f]/.test(n);
}

/** Status for /api/directories. */
export function directoryPickerStatus() {
  return {
    ok: true,
    workspace: path.resolve(WORKSPACE_DIR || process.cwd()),
    maxEntries: MAX_ENTRIES,
    browseEndpoint: '/api/directories/browse?base=…&root=…&showHidden=…&limit=…',
  };
}

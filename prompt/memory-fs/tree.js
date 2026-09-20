// prompt/memory-fs/tree.js
// Phase 25 — Scope E: memory filesystem layout + path resolution.
//
// Production agent memory is a filesystem with permissioned paths — not a
// flat key-value store and not a vector-only retriever. This module DEFINES
// the structure; write enforcement wiring inside server/src/memory/** is a
// zone-owner task (documented at Scope N).
//
// Canonical layout:
//   /profile.md          stable facts about the user
//   /topics/<name>.md    one file per topic the user engages with
//   /areas/<name>.md     recurring work areas
//   /people/<name>.md    people the user mentions
//
// Reserved namespaces (writes refused — see write-rules.js):
//   /system/**           kernel-owned, immutable
//   /refine/**           harness state (Scope B/C territory)
//
// Persistence: REAL files on disk under <projectRoot>/.jexi/memory-fs/
// (the .gitignore `.jexi/` rule covers it). Override the store root with
// env JEXI_MEMORY_FS_ROOT for probes/tests; read at call time.
//
// Zone discipline: this module defines its own error-code constants below.
// prompt/assembly/** is READ-ONLY — the single throw path (list on a bad
// dir) reuses Scope A's PromptError class via import, but errors.js itself
// is not modified and no prompt/assembly file changes.
//
// Determinism: pure functions over (input path, on-disk state). Same input
// + same disk state => same result, always. No locale-aware sorting (the
// default code-unit sort is used for list()).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PromptError } from '../assembly/errors.js';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
// tree.js lives at <projectRoot>/prompt/memory-fs/tree.js
export const PROJECT_ROOT = path.resolve(MODULE_DIR, '..', '..', '..');

/**
 * Error codes defined by the memory-fs zone (Scope E).
 * Stable machine-readable codes: callers branch on behavior, never on text.
 */
export const CODES = Object.freeze({
  PATH_TRAVERSAL: 'E_PATH_TRAVERSAL',
  RESERVED_NAMESPACE: 'E_RESERVED_NAMESPACE',
  READ_BEFORE_WRITE: 'E_READ_BEFORE_WRITE',
  INVALID_PATH: 'E_INVALID_PATH',
  INVALID_WRITER: 'E_INVALID_WRITER',
  INVALID_CONTENT: 'E_INVALID_CONTENT',
});

/** Canonical filesystem layout (frozen — structural contract). */
export const LAYOUT = Object.freeze({
  ROOT_FILES: Object.freeze(['profile.md']),
  COLLECTIONS: Object.freeze(['topics', 'areas', 'people']),
  RESERVED: Object.freeze(['system', 'refine']),
  COLLECTION_SET: Object.freeze(new Set(['topics', 'areas', 'people'])),
  RESERVED_SET: Object.freeze(new Set(['system', 'refine'])),
});

const MAX_NAME_LEN = 128;

/**
 * Store root on disk. Read at CALL time so probe processes can isolate
 * runs via env (and so the default stays <projectRoot>/.jexi/memory-fs).
 */
export function storeRoot() {
  const override = process.env.JEXI_MEMORY_FS_ROOT;
  if (typeof override === 'string' && override.trim() !== '') {
    return path.resolve(override);
  }
  return path.join(PROJECT_ROOT, '.jexi', 'memory-fs');
}

/** Map a NORMALIZED virtual absolute path to its on-disk location. */
export function toDisk(absoluteVirtual) {
  return path.join(storeRoot(), absoluteVirtual);
}

function invalid(rawPath, code, message) {
  return {
    absolute: typeof rawPath === 'string' ? rawPath : '',
    parent: null,
    kind: null,
    valid: false,
    error: { code, message },
  };
}

function isReservedHead(head) {
  return LAYOUT.RESERVED_SET.has(String(head).toLowerCase());
}

/**
 * tree.resolve(path) -> { absolute, parent, kind, valid, error? }
 *
 * Normalization (RULE 7):
 *   - leading slash optional          'topics/rust'  -> '/topics/rust.md'
 *   - trailing .md optional for
 *     topic/area/people names         '/topics/rust' -> '/topics/rust.md'
 *   - duplicate slashes collapsed, trailing slash dropped
 *   - '/profile' is accepted as the root file and normalized to
 *     '/profile.md' (lenient root-file form; canonical is '/profile.md')
 *
 * Security (RULE 1): '..' segments (raw OR percent-decoded, so %2F/%2E
 * cannot slip through), null bytes, and backslashes (absolute-injection
 * vector) are refused with E_PATH_TRAVERSAL.
 *
 * Reserved namespaces (RULES 2/3/8) resolve STRUCTURALLY — the head
 * segment is matched case-insensitively ('/SYSTEM/x.md' normalizes to
 * itself and is flagged by write-rules) — but writability is refused
 * downstream, and they are never backed by this store (exists -> false).
 */
export function resolve(input) {
  if (typeof input !== 'string' || input.trim() === '') {
    return invalid(input, CODES.INVALID_PATH, 'path must be a non-empty string');
  }

  // One decode pass so encoded traversal (%2F, %2E) cannot slip through.
  // Malformed percent-sequences keep the raw string (they cannot decode
  // into a separator, so they are not an escape vector).
  let decoded = input;
  try {
    decoded = decodeURIComponent(input);
  } catch {
    decoded = input;
  }

  // Security screening on raw AND decoded forms (RULE 1).
  for (const candidate of new Set([input, decoded])) {
    if (candidate.includes('\0')) {
      return invalid(input, CODES.PATH_TRAVERSAL, 'null byte in path');
    }
    if (candidate.includes('\\')) {
      return invalid(input, CODES.PATH_TRAVERSAL, 'backslash in path (absolute-injection vector)');
    }
    if (candidate.split('/').some((seg) => seg === '..')) {
      return invalid(input, CODES.PATH_TRAVERSAL, 'path traversal refused: ".." segment');
    }
  }

  // Normalize: leading slash optional, collapse '//', strip trailing '/'.
  let p = decoded.startsWith('/') ? decoded : `/${decoded}`;
  p = p.replace(/\/{2,}/g, '/');
  if (p.length > 1) p = p.replace(/\/+$/, '');
  if (p === '') p = '/';

  const segs = p === '/' ? [] : p.slice(1).split('/');

  if (segs.length === 0) {
    return { absolute: '/', parent: null, kind: 'directory', valid: true };
  }

  const head = segs[0];

  // Reserved namespaces — structural resolution only (RULES 2/3/8 apply
  // to WRITES; case-insensitive head match is scoped to reserved only).
  if (isReservedHead(head)) {
    if (segs.length === 1) {
      return { absolute: `/${head}`, parent: '/', kind: 'directory', valid: true };
    }
    return {
      absolute: p,
      parent: `/${head}`,
      kind: segs.length === 2 ? 'file' : 'directory',
      valid: true,
    };
  }

  // Canonical collections: /topics /areas /people — flat, one level deep.
  if (LAYOUT.COLLECTION_SET.has(head)) {
    if (segs.length === 1) {
      return { absolute: `/${head}`, parent: '/', kind: 'directory', valid: true };
    }
    if (segs.length === 2) {
      let name = segs[1];
      if (name.endsWith('.md')) name = name.slice(0, -3); // trailing .md optional (RULE 7)
      if (
        name === '' ||
        name.startsWith('.') ||
        /[\u0000-\u001f]/.test(name) ||
        name.length > MAX_NAME_LEN
      ) {
        return invalid(input, CODES.INVALID_PATH, `invalid entry name "/${head}/${segs[1]}"`);
      }
      return { absolute: `/${head}/${name}.md`, parent: `/${head}`, kind: 'file', valid: true };
    }
    return invalid(input, CODES.INVALID_PATH, `/${head}/** is flat — nested paths not allowed`);
  }

  // Root file: /profile.md ('/profile' accepted, normalized to .md form).
  if ((head === 'profile.md' || head === 'profile') && segs.length === 1) {
    return { absolute: '/profile.md', parent: '/', kind: 'file', valid: true };
  }

  return invalid(
    input,
    CODES.INVALID_PATH,
    'path outside canonical memory layout (allowed: /profile.md, /topics/<name>.md, /areas/<name>.md, /people/<name>.md)',
  );
}

/**
 * tree.exists(path) -> boolean
 * Invalid paths -> false. Reserved namespaces -> false (never backed by
 * this store). Directories exist only when present on disk as directories.
 */
export function exists(input) {
  const r = resolve(input);
  if (!r.valid) return false;
  const head = r.absolute === '/' ? '' : r.absolute.slice(1).split('/')[0];
  if (head && isReservedHead(head)) return false;
  try {
    const st = fs.statSync(toDisk(r.absolute));
    return r.kind === 'directory' ? st.isDirectory() : st.isFile();
  } catch {
    return false;
  }
}

/**
 * tree.list(dir) -> [{ path, kind, sizeBytes }]
 * Sorted by path (code-unit order — deterministic). Missing directory ->
 * [] (not an error, mirrors RULE 5's caller-decides philosophy). Reserved
 * namespaces hold no store files -> []. A malformed or file path input
 * throws PromptError (E_INVALID_PATH) — a listing of garbage is a caller
 * bug, not an empty result.
 */
export function list(dir) {
  const r = resolve(dir);
  if (!r.valid) {
    throw new PromptError(r.error.code, `cannot list "${dir}" — ${r.error.message}`);
  }
  if (r.kind !== 'directory') {
    throw new PromptError(CODES.INVALID_PATH, `cannot list a file path "${r.absolute}"`);
  }

  const head = r.absolute === '/' ? '' : r.absolute.slice(1).split('/')[0];
  if (head && isReservedHead(head)) return [];

  let names;
  try {
    names = fs.readdirSync(toDisk(r.absolute));
  } catch {
    return []; // directory not present yet — empty, not an error
  }

  const base = toDisk(r.absolute);
  const entries = [];
  for (const name of names.sort()) {
    try {
      const st = fs.statSync(path.join(base, name));
      const isDir = st.isDirectory();
      entries.push({
        path: r.absolute === '/' ? `/${name}` : `${r.absolute}/${name}`,
        kind: isDir ? 'directory' : 'file',
        sizeBytes: isDir ? 0 : st.size,
      });
    } catch {
      // entry vanished mid-listing — skip (deterministic per stable disk state)
    }
  }
  return entries;
}

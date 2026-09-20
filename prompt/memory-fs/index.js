// prompt/memory-fs/index.js
// Phase 25 — Scope E. Public surface of the memory filesystem.
//
// Contract spellings:
//   tree.resolve(path)                    -> { absolute, parent, kind, valid, error? }
//   tree.list(dir)                        -> [{ path, kind, sizeBytes }]
//   tree.exists(path)                     -> boolean
//   writeRules.canWrite(path, writer, ctx)-> { allowed, reason?, errorCode? }
//   readRules.requiresPriorRead(path, ctx)-> { required, satisfied, errorCode? }
//   memoryFs.write(path, content, writer, ctx)
//                                         -> { written, absolutePath?, errorCode? }
//   memoryFs.read(path, ctx)              -> { content: string|null, exists }
//
// Rules implemented (see module headers for detail):
//   RULE 1  traversal refused                -> E_PATH_TRAVERSAL
//   RULE 2  /system/** writes refused        -> E_RESERVED_NAMESPACE
//   RULE 3  /refine/** writes refused        -> E_RESERVED_NAMESPACE
//   RULE 4  new topic auto-creates /topics/ — the IMMEDIATE parent only,
//           never a recursive virtual-tree mkdir
//   RULE 5  reading a missing path is NOT an error -> { content: null, exists: false }
//   RULE 6  read-before-write for UPDATE (not CREATE)
//   RULE 7  normalization: leading slash + trailing .md optional
//   RULE 8  reserved-namespace check case-insensitive, on the
//           normalized path
//
// Persistence: REAL fs reads/writes under <projectRoot>/.jexi/memory-fs/
// (gitignored via the .jexi/ rule). No simulation, no in-memory shim.

import fs from 'node:fs';
import nodePath from 'node:path';
import * as tree from './tree.js';
import * as writeRules from './write-rules.js';
import * as readRules from './read-rules.js';

export { tree, writeRules, readRules };
export const CODES = tree.CODES;
export const LAYOUT = tree.LAYOUT;
export const storeRoot = tree.storeRoot;
export const PROJECT_ROOT = tree.PROJECT_ROOT;

/** Record a successful file read into ctx.session.reads (RULE 6 tracking). */
function recordRead(ctx, absolute) {
  const session = ctx && typeof ctx === 'object' ? ctx.session : undefined;
  if (session && typeof session === 'object') {
    if (!(session.reads instanceof Set)) session.reads = new Set();
    session.reads.add(absolute);
  }
}

export const memoryFs = {
  /**
   * memoryFs.write(path, content, writer, ctx)
   *   -> { written, absolutePath?, reason?, errorCode? }
   *
   * Order of enforcement:
   *   1. writeRules.canWrite  (traversal / reserved / directory shape / role)
   *   2. content type check   (string only)
   *   3. UPDATE? -> readRules.requiresPriorRead (RULE 6)
   *   4. real disk write; auto-create IMMEDIATE parent only (RULE 4)
   */
  write(path, content, writer, ctx) {
    const cw = writeRules.canWrite(path, writer, ctx);
    if (!cw.allowed) {
      return { written: false, reason: cw.reason, errorCode: cw.errorCode };
    }

    if (typeof content !== 'string') {
      return {
        written: false,
        reason: 'content must be a string',
        errorCode: CODES.INVALID_CONTENT,
      };
    }

    const r = tree.resolve(path); // valid — canWrite already passed

    const isUpdate = tree.exists(r.absolute);
    if (isUpdate) {
      const pr = readRules.requiresPriorRead(r.absolute, ctx);
      if (pr.errorCode) {
        return {
          written: false,
          reason: 'update of an existing file requires a prior read in the current session (RULE 6)',
          errorCode: pr.errorCode,
        };
      }
    }

    const root = tree.storeRoot();
    // Infrastructure bootstrap OUTSIDE the virtual tree: make sure the
    // store root exists. Virtual-tree parents are created NON-recursive
    // below — RULE 4 auto-creates only the immediate parent.
    fs.mkdirSync(root, { recursive: true });

    if (r.parent && r.parent !== '/') {
      try {
        fs.mkdirSync(nodePath.join(root, r.parent), { recursive: false });
      } catch (e) {
        if (e.code !== 'EEXIST') throw e;
      }
    }

    fs.writeFileSync(nodePath.join(root, r.absolute), content, 'utf8');
    return { written: true, absolutePath: r.absolute };
  },

  /**
   * memoryFs.read(path, ctx) -> { content: string|null, exists: boolean }
   *
   * RULE 5: a missing path is NOT an error — { content: null, exists: false }
   * and the caller decides. Reserved namespaces are never backed by this
   * store (reads report not-found; nothing is read from their disk paths).
   * Successful file reads are recorded into ctx.session.reads (RULE 6).
   * Invalid (traversal/malformed) inputs additionally carry errorCode so
   * refusals stay visible without throwing.
   */
  read(path, ctx) {
    const r = tree.resolve(path);
    if (!r.valid) {
      return { content: null, exists: false, errorCode: r.error.code };
    }

    const head = r.absolute === '/' ? '' : r.absolute.slice(1).split('/')[0];
    if (head && tree.LAYOUT.RESERVED_SET.has(head.toLowerCase())) {
      return { content: null, exists: false }; // reserved: never stored here
    }

    const disk = nodePath.join(tree.storeRoot(), r.absolute);
    let st;
    try {
      st = fs.statSync(disk);
    } catch {
      return { content: null, exists: false }; // RULE 5 — missing, not an error
    }

    if (st.isDirectory()) {
      return { content: null, exists: true }; // directories have no content
    }

    let content;
    try {
      content = fs.readFileSync(disk, 'utf8');
    } catch {
      return { content: null, exists: false };
    }

    recordRead(ctx, r.absolute);
    return { content, exists: true };
  },
};

export default memoryFs;

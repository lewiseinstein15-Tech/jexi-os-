// prompt/memory-fs/read-rules.js
// Phase 25 — Scope E: "read before write" enforcement (RULE 6).
//
//   Overwriting an EXISTING file (UPDATE) requires that the caller has
//   read that path in the current session. Creating a NEW file (CREATE)
//   does not require a prior read.
//
// Session tracking shape (ctx):
//   ctx.session.reads — a Set (or array) of absolute virtual paths that
//   have been successfully read this session. memoryFs.read() records
//   into it; this module only consults it. A missing/empty session means
//   "nothing read yet" for existing files -> E_READ_BEFORE_WRITE.
//
// RULE 5 interplay: reading a missing path is NOT an error — but it also
// does not satisfy a later update, because there was no current content
// to have seen. Only successful file reads count.

import { resolve, exists, LAYOUT, CODES } from './tree.js';

/**
 * readRules.requiresPriorRead(path, ctx)
 *   -> { required: boolean, satisfied: boolean, errorCode?: string }
 *
 * required   — true when the path exists on disk (an UPDATE in waiting)
 * satisfied  — true when the prior-read condition is met (vacuously true
 *              when not required)
 * errorCode  — E_READ_BEFORE_WRITE when required && !satisfied
 *
 * Invalid paths surface their structural code (E_PATH_TRAVERSAL /
 * E_INVALID_PATH); reserved namespaces surface E_RESERVED_NAMESPACE
 * (their writes are refused upstream regardless).
 */
export function requiresPriorRead(path, ctx) {
  const r = resolve(path);
  if (!r.valid) {
    return { required: false, satisfied: false, errorCode: r.error.code };
  }

  const head = r.absolute === '/' ? '' : r.absolute.slice(1).split('/')[0];
  if (head && LAYOUT.RESERVED_SET.has(head.toLowerCase())) {
    return { required: false, satisfied: false, errorCode: CODES.RESERVED_NAMESPACE };
  }

  const required = exists(r.absolute);
  if (!required) {
    return { required: false, satisfied: true }; // CREATE — no prior read needed
  }

  const session = ctx && typeof ctx === 'object' ? ctx.session : undefined;
  const reads = session && typeof session === 'object' ? session.reads : undefined;

  let satisfied = false;
  if (reads instanceof Set) satisfied = reads.has(r.absolute);
  else if (Array.isArray(reads)) satisfied = reads.includes(r.absolute);

  if (!satisfied) {
    return { required: true, satisfied: false, errorCode: CODES.READ_BEFORE_WRITE };
  }
  return { required: true, satisfied: true };
}

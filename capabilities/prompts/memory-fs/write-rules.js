// prompt/memory-fs/write-rules.js
// Phase 25 — Scope E: what can / cannot be written, and by whom.
//
// Enforced here (per Scope E rules):
//   RULE 1  path traversal (.., absolute injection, encoding tricks)
//                                             -> E_PATH_TRAVERSAL
//   RULE 2  writes to /system/**              -> E_RESERVED_NAMESPACE
//   RULE 3  writes to /refine/**              -> E_RESERVED_NAMESPACE
//   RULE 8  reserved check applies to the NORMALIZED path and is
//           case-insensitive on reserved namespaces only
//           ('/SYSTEM/x.md' and '/System/x.md' both refuse)
//                                             -> E_RESERVED_NAMESPACE
//
// Writer model (minimal, per scope contract): writer is { role } or a
// plain role string. Known roles: agent | kernel | system | user. Every
// known role may write the canonical memory surface (/profile.md,
// /topics/**, /areas/**, /people/**). Reserved namespaces are refused
// UNCONDITIONALLY — including kernel — because /system is immutable and
// /refine belongs to the harness. Unknown roles are refused
// (E_INVALID_WRITER). Per-session read-before-write gating lives in
// read-rules.js, not here.
//
// NOTE: enforcement wiring inside server/src/memory/** is a zone-owner
// task (documented at Scope N); this module only DEFINES the rules.
// The ctx parameter is accepted for contract compatibility and reserved
// for that future wiring — it does not weaken any check below.

import { resolve, LAYOUT, CODES } from './tree.js';

export const ROLES = Object.freeze(['agent', 'kernel', 'system', 'user']);

function roleOf(writer) {
  if (writer === undefined || writer === null) return 'agent'; // default actor
  if (typeof writer === 'string') return writer;
  if (typeof writer === 'object' && typeof writer.role === 'string') return writer.role;
  return 'agent';
}

/**
 * writeRules.canWrite(path, writer, ctx)
 *   -> { allowed: boolean, reason?: string, errorCode?: string }
 *
 * Order of enforcement: structural validity -> reserved namespace ->
 * directory-shape refusal -> writer role. First refusal wins; `allowed`
 * is true only when every gate passes.
 */
export function canWrite(path, writer, ctx /* reserved for Scope N enforcement wiring */) {
  const r = resolve(path);
  if (!r.valid) {
    return { allowed: false, reason: r.error.message, errorCode: r.error.code };
  }

  // RULES 2/3/8 — normalized path, head segment case-insensitive.
  const head = r.absolute === '/' ? '' : r.absolute.slice(1).split('/')[0];
  if (head && LAYOUT.RESERVED_SET.has(head.toLowerCase())) {
    const ns = head.toLowerCase();
    const why = ns === 'system'
      ? 'kernel-owned, immutable'
      : 'harness state (Scope B/C territory)';
    return {
      allowed: false,
      reason: `writes to /${ns}/** are refused — reserved namespace (${why}) [input: ${r.absolute}]`,
      errorCode: CODES.RESERVED_NAMESPACE,
    };
  }

  // Writes target files. Directory-shaped paths (collection roots, '/')
  // are part of the structure, not the writable surface.
  if (r.kind === 'directory') {
    return {
      allowed: false,
      reason: `cannot write a directory path "${r.absolute}" — writes target files`,
      errorCode: CODES.INVALID_PATH,
    };
  }

  const role = roleOf(writer);
  if (!ROLES.includes(role)) {
    return {
      allowed: false,
      reason: `unknown writer role "${role}" — known roles: ${ROLES.join(' | ')}`,
      errorCode: CODES.INVALID_WRITER,
    };
  }

  return { allowed: true };
}

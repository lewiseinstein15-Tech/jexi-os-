// prompt/assembly/boundary.js
// Dynamic boundary + cache marker (Phase 25, Scope B).
//
// The canonical prompt has ONE cache boundary: sections 01-05 are
// static (cache-stable across turns), sections 06-10 are dynamic
// (rebuilt every turn). This module computes that boundary as a REAL
// byte offset over the assembled prompt text and derives a
// deterministic cache key over the static block ONLY.
//
// BYTE MODEL (documented contract):
//   full text   = staticText + "\n" + dynamicText
//   staticText  = static sections' contents joined by "\n" (in list order)
//   dynamicText = dynamic sections' contents joined by "\n" (in list order)
//
//   staticEnd    = Buffer.byteLength(staticText, 'utf8')
//                  exclusive end of the static block; the single
//                  separator byte sits AT this offset.
//   dynamicStart = staticEnd + 1 — offset of the first dynamic byte.
//
//   staticEnd is a byte offset; staticCharCount/dynamicCharCount are
//   JS string lengths (UTF-16 code units). They differ under UTF-8 —
//   both are reported so callers never confuse the two.
//
// CACHE MODEL:
//   cacheKey = sha256(utf8(staticText)) — hex. It never reads
//   dynamic content: same static block -> same key across processes;
//   a dynamic-only edit cannot move it; a static edit always does.
//
// INPUT CONTRACT:
//   sections = array of BUILT sections: { id, kind, content }.
//   Extra fields (label, order, build, ...) are ignored. Registry
//   specs must be built first (spec.build(ctx) -> content) — this
//   module consumes built output, not specs.
//
// ERROR VOCABULARY (reuses Scope A's PromptError via errors.js):
//   E_INVALID_SECTION      - malformed list/section, or a section
//                            whose kind contradicts the canonical
//                            split imported from order.js
//   E_STATIC_AFTER_DYNAMIC - ordering violation
// Pure module: no registry state is read or written at compute time.

import { createHash } from 'node:crypto';
import { PromptError, isPromptError } from './errors.js';
import { CANONICAL_IDS, STATIC_SECTION_IDS, DYNAMIC_SECTION_IDS } from './order.js';

export { PromptError, isPromptError };

/** The single byte between the static and dynamic blocks. */
export const BOUNDARY_SEPARATOR = '\n';

// The static/dynamic split is IMPORTED from order.js (Scope A) —
// never re-derived here.
const CANONICAL_KIND_BY_ID = new Map();
for (const id of STATIC_SECTION_IDS) CANONICAL_KIND_BY_ID.set(id, 'static');
for (const id of DYNAMIC_SECTION_IDS) CANONICAL_KIND_BY_ID.set(id, 'dynamic');

// Load-time integrity check: the imported split must exactly cover
// the canonical id set. If order.js ever drifts, this module fails
// loudly at import time instead of corrupting boundaries silently.
{
  const covered = [...CANONICAL_KIND_BY_ID.keys()].sort().join(',');
  const canonical = [...CANONICAL_IDS].sort().join(',');
  if (covered !== canonical) {
    throw new PromptError(
      'E_INVALID_SECTION',
      'order.js canonical split drift: STATIC_SECTION_IDS + DYNAMIC_SECTION_IDS do not exactly cover CANONICAL_IDS',
      { covered, canonical }
    );
  }
}

function isBuiltSection(s) {
  return (
    typeof s === 'object' && s !== null && !Array.isArray(s) &&
    typeof s.id === 'string' && s.id !== '' &&
    (s.kind === 'static' || s.kind === 'dynamic') &&
    typeof s.content === 'string'
  );
}

/**
 * Validate a built-section list.
 * Throws PromptError E_INVALID_SECTION with the offending index in
 * details. Refuses: non-array, non-object elements, missing/invalid
 * id, missing/invalid kind, non-string content, and any canonical-id
 * section whose kind contradicts the imported canonical split.
 * Pure — touches no registry and no filesystem.
 */
export function requireSectionList(sections) {
  if (!Array.isArray(sections)) {
    throw new PromptError('E_INVALID_SECTION', 'sections must be an array of built sections { id, kind, content }', { got: typeof sections });
  }
  sections.forEach((s, index) => {
    if (!isBuiltSection(s)) {
      throw new PromptError(
        'E_INVALID_SECTION',
        `sections[${index}] is not a valid built section { id, kind, content }`,
        {
          index,
          id: typeof s === 'object' && s !== null ? String(s.id) : typeof s,
          kind: typeof s === 'object' && s !== null && 'kind' in s ? String(s.kind) : '(missing)',
        }
      );
    }
    const canonicalKind = CANONICAL_KIND_BY_ID.get(s.id);
    if (canonicalKind !== undefined && canonicalKind !== s.kind) {
      throw new PromptError(
        'E_INVALID_SECTION',
        `section "${s.id}" declares kind '${s.kind}' but the canonical split (order.js) defines it as '${canonicalKind}'`,
        { index, id: s.id, kind: s.kind, canonicalKind }
      );
    }
  });
  return sections;
}

// Internal: assumes a validated list.
function scanStaticBeforeDynamic(sections) {
  let firstDynamicId = null;
  for (const s of sections) {
    if (s.kind === 'dynamic') {
      if (firstDynamicId === null) firstDynamicId = s.id;
    } else if (firstDynamicId !== null) {
      throw new PromptError(
        'E_STATIC_AFTER_DYNAMIC',
        `static section "${s.id}" appears after dynamic section "${firstDynamicId}"`,
        { staticId: s.id, firstDynamicId }
      );
    }
  }
}

// Internal: hash of ONLY the static block (non-static members ignored).
function staticBlockHash(sections) {
  const staticText = sections.filter((s) => s.kind === 'static').map((s) => s.content).join(BOUNDARY_SEPARATOR);
  return createHash('sha256').update(staticText, 'utf8').digest('hex');
}

// Internal: join the contents of one kind.
function blockText(sections, kind) {
  return sections.filter((s) => s.kind === kind).map((s) => s.content).join(BOUNDARY_SEPARATOR);
}

/**
 * Public order assertion. True when valid; throws
 * E_INVALID_SECTION (malformed input) or E_STATIC_AFTER_DYNAMIC
 * (any static section appearing after any dynamic section).
 */
export function assertOrder(sections) {
  requireSectionList(sections);
  scanStaticBeforeDynamic(sections);
  return true;
}

/**
 * Deterministic hash of ONLY the static section block.
 * Accepts a full mixed list — non-static members are ignored, they
 * cannot influence the key. Same static input -> same hex digest
 * across processes (sha256 over utf8 bytes of the joined static
 * block; no timestamps, no object serialization).
 */
export function cacheKey(sections) {
  requireSectionList(sections);
  return staticBlockHash(sections);
}

/**
 * boundary.compute(sections) -> {
 *   staticEnd,        // byte offset where the static block ends
 *   dynamicStart,     // == staticEnd + 1
 *   staticCharCount,  // JS chars in the static block
 *   dynamicCharCount, // JS chars in the dynamic block
 *   cacheKey,         // sha256 hex of the static block ONLY
 *   valid             // true (violations throw, never return)
 * }
 * Throws E_INVALID_SECTION or E_STATIC_AFTER_DYNAMIC. On the throw
 * path nothing is returned and no state anywhere is touched.
 */
export function compute(sections) {
  requireSectionList(sections);
  scanStaticBeforeDynamic(sections);
  const staticText = blockText(sections, 'static');
  const dynamicText = blockText(sections, 'dynamic');
  const staticEnd = Buffer.byteLength(staticText, 'utf8');
  return Object.freeze({
    staticEnd,
    dynamicStart: staticEnd + 1,
    staticCharCount: staticText.length,
    dynamicCharCount: dynamicText.length,
    cacheKey: staticBlockHash(sections),
    valid: true,
  });
}

// Namespace export so callers can use the contract spelling
// `boundary.compute(...)` / `boundary.cacheKey(...)`.
export const boundary = Object.freeze({
  compute,
  cacheKey,
  assertOrder,
  requireSectionList,
  BOUNDARY_SEPARATOR,
});

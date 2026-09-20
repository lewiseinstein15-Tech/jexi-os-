// prompt/memory-fs/epistemic.js
// Phase 25 — Scope F: epistemological tagging ([stated] vs [inferred]).
//
// Every memory write must carry its epistemic source. Did the user say
// it ([stated]) or did the model infer it ([inferred])? The model can
// NEVER write its own inferences. That is how hallucinations compound:
// an inference gets written, later treated as fact, and drives future
// decisions.
//
// Contract spellings:
//   epistemic.tag(content, source, opts)
//       -> { tagged, writable, tag, reason?, errorCode? }
//   epistemic.detectTag(content)
//       -> { tag: 'stated'|'inferred'|null, cleanContent }
//   epistemic.assertWritable(taggedEntry)
//       -> { ok, tag, errorCode? }
//
// Sources:
//   'user'   -> [stated]   writable:true
//   'model'  -> [inferred] writable:false  -> E_INFERRED_NOT_WRITABLE
//   'system' -> allowed ONLY with {systemWritable:true}
//               otherwise E_SYSTEM_WRITE_REFUSED; when allowed it tags
//               as [stated] (platform ground truth; detectTag's tag set
//               is closed to stated|inferred)
//
// Rules implemented:
//   RULE 1  tag is ALWAYS the first token: "[stated] " / "[inferred] "
//           (exact lowercase literal + one trailing space)
//   RULE 2  no entry written without a tag -> E_UNTAGGED
//   RULE 3  [inferred] content NEVER written -> E_INFERRED_NOT_WRITABLE
//   RULE 4  detectTag on untagged -> { tag:null, cleanContent:<content> },
//           never throws; READING is allowed for both tags — only
//           writing is restricted
//   RULE 5  mid-text "[stated]" is NOT a tag — only the leading token
//           counts (regex anchored at string start)
//   RULE 6  double-tagging refused -> E_DOUBLE_TAG ("[stated] [inferred] foo")
//
// Zone: prompt/memory-fs/** (Scope F). This module is additive to Scope
// E: tree.js / write-rules.js / read-rules.js are NOT modified. It
// reuses Scope E's local code vocabulary for the non-string content
// case (E_INVALID_CONTENT from tree.js CODES) and defines its own
// epistemic codes below.

import { CODES as TREE_CODES } from './tree.js';

/** Epistemic error codes (Scope F vocabulary). */
export const EPISTEMIC_CODES = Object.freeze({
  INFERRED_NOT_WRITABLE: 'E_INFERRED_NOT_WRITABLE',
  SYSTEM_WRITE_REFUSED: 'E_SYSTEM_WRITE_REFUSED',
  UNTAGGED: 'E_UNTAGGED',
  DOUBLE_TAG: 'E_DOUBLE_TAG',
  UNKNOWN_SOURCE: 'E_UNKNOWN_SOURCE',
});

/** The closed tag set. */
export const TAGS = Object.freeze({ STATED: 'stated', INFERRED: 'inferred' });

/**
 * Leading-tag pattern — anchored at string start (RULES 1/5): the exact
 * lowercase literal, one trailing space, nothing before it. '[STATED]',
 * '[stated]foo' (no space) and ' [stated] x' (leading space) are NOT tags.
 */
const TAG_RE = /^\[(stated|inferred)\] /;

const SOURCES = Object.freeze(['user', 'model', 'system']);

const INFERENCE_REASON =
  'model inferences are never written to memory (inferences treated as facts compound hallucinations)';

/** Internal: split a leading tag off `content` without throwing. */
function detectLeadingTag(content) {
  if (typeof content !== 'string') return { tag: null, cleanContent: content };
  const m = content.match(TAG_RE);
  if (!m) return { tag: null, cleanContent: content };
  return { tag: m[1], cleanContent: content.slice(m[0].length) };
}

/**
 * epistemic.detectTag(content)
 *   -> { tag: 'stated'|'inferred'|null, cleanContent }
 *
 * RULE 4: untagged (or non-string) input -> { tag:null, cleanContent }
 * with the content passed through unchanged. Never throws. Only a
 * leading "[stated] "/"[inferred] " token counts (RULE 5); mid-text
 * occurrences stay part of cleanContent verbatim.
 */
export function detectTag(content) {
  return detectLeadingTag(content);
}

/**
 * epistemic.tag(content, source, opts)
 *   -> { tagged, writable, tag, reason?, errorCode? }
 *
 * Builds the tagged entry `content` must carry. For 'model' the would-be
 * tagged string IS returned (with writable:false + E_INFERRED_NOT_WRITABLE)
 * so callers can display what was withheld — but memoryFs.write refuses it
 * before any disk touch (RULE 3). Content that already begins with a tag
 * token is refused (RULE 6, E_DOUBLE_TAG) — tagging it again would create
 * a double tag. opts.systemWritable===true is the ONLY way 'system'
 * source passes (E_SYSTEM_WRITE_REFUSED otherwise).
 */
export function tag(content, source, opts = {}) {
  if (typeof content !== 'string' || content.length === 0) {
    return {
      tagged: null,
      writable: false,
      tag: null,
      reason: 'content must be a non-empty string',
      errorCode: TREE_CODES.INVALID_CONTENT,
    };
  }

  // RULE 6 — already-tagged content would double-tag.
  const existing = detectLeadingTag(content);
  if (existing.tag !== null) {
    return {
      tagged: null,
      writable: false,
      tag: existing.tag,
      reason: `content already carries a leading [${existing.tag}] tag — tagging again would double-tag`,
      errorCode: EPISTEMIC_CODES.DOUBLE_TAG,
    };
  }

  if (typeof source !== 'string' || !SOURCES.includes(source)) {
    return {
      tagged: null,
      writable: false,
      tag: null,
      reason: `unknown source "${String(source)}" — known sources: ${SOURCES.join(' | ')}`,
      errorCode: EPISTEMIC_CODES.UNKNOWN_SOURCE,
    };
  }

  if (source === 'model') {
    return {
      tagged: `[${TAGS.INFERRED}] ${content}`,
      writable: false,
      tag: TAGS.INFERRED,
      reason: INFERENCE_REASON,
      errorCode: EPISTEMIC_CODES.INFERRED_NOT_WRITABLE,
    };
  }

  if (source === 'system') {
    if (!(opts && opts.systemWritable === true)) {
      return {
        tagged: `[${TAGS.STATED}] ${content}`,
        writable: false,
        tag: TAGS.STATED,
        reason: 'system-source writes are refused unless opts.systemWritable is explicitly true',
        errorCode: EPISTEMIC_CODES.SYSTEM_WRITE_REFUSED,
      };
    }
    return { tagged: `[${TAGS.STATED}] ${content}`, writable: true, tag: TAGS.STATED };
  }

  // source === 'user'
  return { tagged: `[${TAGS.STATED}] ${content}`, writable: true, tag: TAGS.STATED };
}

/**
 * epistemic.assertWritable(taggedEntry) -> { ok, tag, errorCode? }
 *
 * Gate used by memoryFs.write BEFORE touching disk (Scope F integration):
 *   '[stated] foo'            -> { ok:true,  tag:'stated' }
 *   '[inferred] foo'          -> { ok:false, tag:'inferred', E_INFERRED_NOT_WRITABLE }
 *   'foo' (no leading tag)    -> { ok:false, tag:null,       E_UNTAGGED }
 *   '[stated] [inferred] foo' -> { ok:false, tag:'stated',   E_DOUBLE_TAG }
 * Non-string input is treated as untagged (no throw).
 */
export function assertWritable(taggedEntry) {
  const d = detectLeadingTag(taggedEntry);
  if (d.tag === null) {
    return {
      ok: false,
      tag: null,
      reason: 'entry carries no epistemic tag — every memory entry must start with [stated] or [inferred]',
      errorCode: EPISTEMIC_CODES.UNTAGGED,
    };
  }

  // RULE 6 — a residual leading tag after stripping means double-tagged.
  const residual = detectLeadingTag(d.cleanContent);
  if (residual.tag !== null) {
    return {
      ok: false,
      tag: d.tag,
      reason: `entry is double-tagged ([${d.tag}] ... [${residual.tag}]) — exactly one tag allowed`,
      errorCode: EPISTEMIC_CODES.DOUBLE_TAG,
    };
  }

  if (d.tag === TAGS.INFERRED) {
    return { ok: false, tag: TAGS.INFERRED, reason: INFERENCE_REASON, errorCode: EPISTEMIC_CODES.INFERRED_NOT_WRITABLE };
  }

  return { ok: true, tag: d.tag };
}

/**
 * JEXI OS — AGENT — WritePayloadNormalizer.
 *
 * M19 — a write-tool call whose `content` was double-escaped writes a broken
 * file. The model answers with a JSON string whose value contains the literal
 * two-character sequences `\n` and `\t` (a backslash followed by `n`/`t`)
 * instead of real newlines and tabs, so `fs_write` faithfully writes
 * `def f():\n    return 1` as ONE line and the file no longer parses:
 *
 *     def f():\n    return 1      ->  SyntaxError: unexpected character
 *                                      after line continuation character
 *
 * The defect is narrow and must be repaired narrowly. This module is NOT a
 * general "replace every backslash" pass — that would corrupt Windows paths
 * (`C:\new`), regex literals (`\d`), and source strings that legitimately hold
 * `\\n`. Three rules keep it honest:
 *
 *   1. APPLY ONLY to whole-file bodies — `fs_write` / `fs_append` `content`,
 *      never a search needle or an arbitrary argument.
 *   2. APPLY ONLY when the payload is UNAMBIGUOUSLY double-escaped: it
 *      contains literal `\n`/`\t` and NO real newline. A payload that already
 *      has real newlines is already structured, so it is left untouched.
 *   3. DECODE ONLY OUTSIDE STRING LITERALS. A string-aware scanner tracks
 *      `"…"`, `'…'`, `"""…"""` and `'''…'''` regions; a literal `\n` inside a
 *      quoted region is a legitimate escape (`x = "a\nb"`, JSON, a regex, a
 *      Windows path in a string) and is PRESERVED. Only the structural
 *      separators between statements are decoded — which is exactly the defect.
 *
 * Anything the scanner cannot classify with confidence is left as-is: when the
 * result is not obviously better the original bytes win. The decision is
 * returned so callers can record it.
 */

/** Tools whose `content` argument is a whole-file body (safe to score). */
export const WRITE_CONTENT_TOOLS = new Set(['fs_write', 'fs_append']);

const BS_N = '\\n'; // literal backslash + n  (two characters)
const BS_T = '\\t'; // literal backslash + t
const REAL_NL = '\n';

/** Count occurrences of a literal (non-regex) substring. */
function countOf(hay, needle) {
  if (!needle) return 0;
  let n = 0, i = 0;
  for (;;) {
    const j = hay.indexOf(needle, i);
    if (j === -1) return n;
    n++;
    i = j + needle.length;
  }
}

/**
 * Is this payload unambiguously double-escaped whole-file content?
 *
 * M18/R2 + M19 live measurement: the defect is not always "every newline is a
 * literal `\n`". A model can write MOST line breaks as literal `\n` and emit a
 * single real newline — a MIXED payload (measured: HumanEval/1, 7 literal `\n`
 * against 1 real newline). The original "no real newline at all" guard refused
 * those, so the file was written broken. The guard is therefore:
 *
 *   - no real newline  -> escaped content (unchanged from before); OR
 *   - literal `\n`/`\t` OUTNUMBER real newlines AND there are at least two of
 *     them -> the structural separators are escaped, the stray real newline is
 *     incidental.
 *
 * A legitimate source file has real newlines between statements and only a
 * handful of literal `\n` inside string literals, so it never satisfies the
 * dominance test; and even if a payload is borderline, the string-aware
 * decoder leaves quoted regions untouched and `normalizeWriteArgs` still
 * requires the result to actually differ.
 *
 * @param {string} content
 * @returns {boolean}
 */
export function isDoubleEscapedPayload(content) {
  const s = String(content ?? '');
  if (!s) return false;
  const literal = countOf(s, BS_N) + countOf(s, BS_T);
  if (!literal) return false;
  const realNl = countOf(s, REAL_NL);
  if (realNl === 0) return true;
  return literal >= 2 && literal > realNl;
}

/**
 * Decode literal `\n` / `\t` / `\r` control sequences that appear in CODE
 * regions, leaving quoted regions untouched.
 *
 * A hand-written scanner (no regex) so quote state is exact:
 *   - in code, `\n`/`\t`/`\r` become real characters; every other backslash
 *     (`\\`, `\d`, `\.`, `\"`, `\uXXXX`, a lone trailing `\`) is copied as-is;
 *   - in `"…"` / `'…'`, a backslash escapes the next byte (so `\"` does not
 *     close the string) and NOTHING is decoded;
 *   - in `"""…"""` / `'''…'''`, the region closes on the matching triple.
 *
 * @param {string} content
 * @returns {string}
 */
export function decodeEscapedControls(content) {
  const s = String(content ?? '');
  const n = s.length;
  let out = '';
  let state = 'code'; // code | dq | sq | tdq | tsq
  let i = 0;

  const decodeEscape = (idx) => {
    const nx = s[idx + 1];
    if (nx === 'n') return { text: '\n', len: 2 };
    if (nx === 't') return { text: '\t', len: 2 };
    if (nx === 'r') return { text: '\r', len: 2 };
    return { text: '\\' + (nx ?? ''), len: nx === undefined ? 1 : 2 };
  };

  while (i < n) {
    const c = s[i];
    if (state === 'code') {
      if (s.startsWith('"""', i)) { state = 'tdq'; out += '"""'; i += 3; continue; }
      if (s.startsWith("'''", i)) { state = 'tsq'; out += "'''"; i += 3; continue; }
      if (c === '\\') {
        const d = decodeEscape(i);
        out += d.text; i += d.len; continue;
      }
      if (c === '"') { state = 'dq'; out += c; i++; continue; }
      if (c === "'") { state = 'sq'; out += c; i++; continue; }
      out += c; i++; continue;
    }
    if (state === 'dq' || state === 'sq') {
      const q = state === 'dq' ? '"' : "'";
      if (c === '\\' && i + 1 < n) { out += c + s[i + 1]; i += 2; continue; }
      if (c === q) { state = 'code'; out += c; i++; continue; }
      out += c; i++; continue;
    }
    // triple-quoted regions: closed only by the matching triple
    const tri = state === 'tdq' ? '"""' : "'''";
    if (s.startsWith(tri, i)) { state = 'code'; out += tri; i += 3; continue; }
    if (c === '\\' && i + 1 < n) { out += c + s[i + 1]; i += 2; continue; }
    out += c; i++; continue;
  }
  return out;
}

/**
 * Normalize one tool call's arguments.
 *
 * Returns `{ args, changed, reason, stats? }`. When nothing applies, `args` is
 * the ORIGINAL object (same reference), so callers can compare cheaply.
 *
 * @param {string} slug
 * @param {object} args
 */
export function normalizeWriteArgs(slug, args = {}) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return { args, changed: false, reason: 'not-an-object' };
  if (!WRITE_CONTENT_TOOLS.has(slug)) return { args, changed: false, reason: 'tool-not-write-content' };
  const content = args.content;
  if (typeof content !== 'string') return { args, changed: false, reason: 'content-not-string' };
  if (!isDoubleEscapedPayload(content)) return { args, changed: false, reason: 'not-double-escaped' };
  const decoded = decodeEscapedControls(content);
  if (decoded === content) return { args, changed: false, reason: 'no-op' };
  return {
    args: { ...args, content: decoded },
    changed: true,
    reason: 'decoded-literal-newlines',
    stats: {
      before: { literalNl: countOf(content, BS_N), literalTab: countOf(content, BS_T), realNl: countOf(content, REAL_NL) },
      after: { literalNl: countOf(decoded, BS_N), literalTab: countOf(decoded, BS_T), realNl: countOf(decoded, REAL_NL) },
    },
  };
}

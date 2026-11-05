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
 * M21 — is the whole payload a JSON-ENCODED string (not merely newline-escaped)?
 *
 * The M19 pass decodes `\n`/`\t` only OUTSIDE string literals. Live M21
 * measurement (HumanEval slice, llama3.2:3b) shows a second, broader shape: the
 * model returns the file body as a JSON STRING VALUE, so EVERY quote and
 * backslash is escaped — `\"`, `\\n`, `\"\"\"` — including inside docstrings
 * and string literals. The M19 scanner treats the (escaped) quotes as real
 * string delimiters, so it decodes nothing and writes
 * `def f():\n    \\"\\"\\" doc \\"\\"\\"` verbatim: a SyntaxError
 * ("unexpected character after line continuation character") on 5/9 written
 * files. The tell is unambiguous: an escaped quote or escaped backslash that
 * M19's newline-only scan would never produce. Requiring one of those keeps
 * this from firing on the legitimate payloads M19 already handles (a Windows
 * path, a regex `\d`, JSON *content* whose quotes are unescaped).
 */
export function isFullyJsonEscaped(content) {
  const s = String(content ?? '');
  if (!s) return false;
  /* The definitive tell: an escaped quote in a CODE region. Real Python never
     contains `\"` outside a string literal — a code-region `\"` can only come
     from JSON-encoding the file body, so decoding it is always an improvement.
     An escaped quote INSIDE a string literal (`s = "say \"hi\""`) is legitimate
     and does not fire. */
  if (hasEscapedQuoteInCode(s)) return true;
  /* A JSON string VALUE with no real newlines: it opens and closes with a quote
     and carries escaped quotes. `JSON.stringify(fileBody)` is exactly this. */
  const t = s.trim();
  return t.length >= 2 && t[0] === '"' && t[t.length - 1] === '"' && countOf(s, '\\"') > 0;
}

/** Walk the quote state and report a `\"` seen while in code (not in a string). */
function hasEscapedQuoteInCode(s) {
  const n = s.length;
  let state = 'code';
  let i = 0;
  while (i < n) {
    const c = s[i];
    if (state === 'code') {
      if (s.startsWith('"""', i)) { state = 'tdq'; i += 3; continue; }
      if (s.startsWith("'''", i)) { state = 'tsq'; i += 3; continue; }
      if (c === '\\') {
        if (s[i + 1] === '"') return true;   // code-region escaped quote
        i += s[i + 1] === undefined ? 1 : 2;
        continue;
      }
      if (c === '"') { state = 'dq'; i++; continue; }
      if (c === "'") { state = 'sq'; i++; continue; }
      i++; continue;
    }
    if (state === 'dq' || state === 'sq') {
      const q = state === 'dq' ? '"' : "'";
      if (c === '\\' && i + 1 < n) { i += 2; continue; }
      if (c === q) state = 'code';
      i++; continue;
    }
    const tri = state === 'tdq' ? '"""' : "'''";
    if (s.startsWith(tri, i)) { state = 'code'; i += 3; continue; }
    if (c === '\\' && i + 1 < n) { i += 2; continue; }
    i++; continue;
  }
  return false;
}

/**
 * Decode the JSON string escape set. Because the payload is fully escaped,
 * there is no string-literal state to track: every backslash begins an escape.
 * `\n \t \r \b \f \" \\ \/` and `\uXXXX` are decoded; any other escape
 * (`\d`, `\.`, a lone trailing `\`) is copied verbatim.
 */
export function decodeFullJsonEscapes(content) {
  const s = String(content ?? '');
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== '\\') { out += c; continue; }
    const nx = s[i + 1];
    if (nx === undefined) { out += '\\'; break; }
    if (nx === 'n') { out += '\n'; i++; continue; }
    if (nx === 't') { out += '\t'; i++; continue; }
    if (nx === 'r') { out += '\r'; i++; continue; }
    if (nx === 'b') { out += '\b'; i++; continue; }
    if (nx === 'f') { out += '\f'; i++; continue; }
    if (nx === '"') { out += '"'; i++; continue; }
    if (nx === '\\') { out += '\\'; i++; continue; }
    if (nx === '/') { out += '/'; i++; continue; }
    if (nx === 'u') {
      const hex = s.slice(i + 2, i + 6);
      if (/^[0-9a-fA-F]{4}$/.test(hex)) { out += String.fromCharCode(parseInt(hex, 16)); i += 5; continue; }
    }
    out += '\\' + nx; i++; continue;   // unknown escape — preserved
  }
  return out;
}

/**
 * M21 — the CORRUPTED mixed shape, seen live on 5/9 written files.
 *
 * The exact bytes (HumanEval/1, 2026-11-03) are inconsistent escaping: real
 * newlines between the top-level lines, literal `\n` INSIDE the docstring, and
 * a line whose only content is a STRAY BACKSLASH (`    \`). That last one is
 * the SyntaxError Python actually reports ("unexpected character after line
 * continuation character"), and the file never parses.
 *
 * A line whose only non-whitespace character is a backslash is never valid
 * Python — a real line continuation follows an expression (`a + \`), never an
 * otherwise-empty line — so gating on it cannot touch the legitimate payloads
 * M19 preserves. This signal is independent of the literal/real newline ratio,
 * which the corrupted shape can fall either side of.
 */
export function hasStrayBackslashBeforeNewline(content) {
  return /(^|\n)[ \t]*\\[ \t]*(\r?\n|$)/.test(String(content ?? ''));
}

/**
 * M21 — a line whose ONLY non-whitespace character is a backslash.
 *
 * Live measurement (2026-11-04) found the stray-backslash line is often
 * preceded by a LITERAL `\n` escape rather than a real newline, so the
 * `(^|\n)` anchor above misses it: the bytes are
 * `…List[str]:\n    \` + <real newline> + `    """…`. Decoding the literal
 * escapes first and THEN splitting on real newlines recovers the line shape,
 * and a line that is only whitespace + backslash is never valid Python (a real
 * continuation follows an expression, `a + \`). The gate still requires a
 * literal `\n` to be present, so an ordinary real-newline file is untouched.
 */
export function hasLoneBackslashLine(content) {
  const decoded = String(content ?? '').replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t');
  return decoded.split(/\r?\n/).some((line) => /^[ \t]*\\[ \t]*$/.test(line));
}

/**
 * M21 — is a triple-quoted region left OPEN? The second corrupted shape seen
 * live (HumanEval/2, /6, /11, /13) opens a `"""` docstring and never closes it,
 * because the model typed a LONE BACKSLASH where each docstring newline should
 * be (`into\    and integer part`) and then switched to literal `\n`. Python
 * reports "unterminated triple-quoted string literal" and the file never
 * parses. An odd count of a triple delimiter means a region was left open.
 */
export function hasUnterminatedTripleQuote(content) {
  const s = String(content ?? '');
  return countOf(s, '"""') % 2 === 1 || countOf(s, "'''") % 2 === 1;
}

/**
 * M21 — a LONE BACKSLASH followed by indentation and more code on the same
 * line (`decomposed into\    and integer part`). Real Python never has that
 * outside a string literal, and a string literal would need an escaped space —
 * which the model did not write. It is the model's broken line break, and it
 * glues docstring lines together so a `"""` region never closes.
 */
export function hasBackslashBeforeIndent(content) {
  return /\\[ \t]+[^\s\r\n]/.test(String(content ?? ''));
}

/**
 * Repair a corrupted mixed payload.
 *
 * Two live shapes need this, and both are handled by the same decode:
 *   - a stray backslash where a line break belongs (`    \` on its own line);
 *   - a LONE BACKSLASH gluing two docstring lines together
 *     (`decomposed into\    and integer part`), which leaves a `"""` region
 *     open and raises "unterminated triple-quoted string literal".
 * The JSON escape set is decoded everywhere (there is no reliable string state
 * left to honour), then a lone backslash followed by INDENTATION and more code
 * is restored to a real newline.
 */
export function repairCorruptEscapes(content) {
  const s = String(content ?? '');
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== '\\') { out += c; continue; }
    const nx = s[i + 1];
    if (nx === undefined) { out += '\\'; break; }
    if (nx === 'n') { out += '\n'; i++; continue; }
    if (nx === 't') { out += '\t'; i++; continue; }
    if (nx === 'r') { out += '\r'; i++; continue; }
    if (nx === '"') { out += '"'; i++; continue; }
    if (nx === '\\') { out += '\\'; i++; continue; }
    if (nx === '/') { out += '/'; i++; continue; }
    if (nx === '\n') { i++; continue; }                       // stray line-continuation backslash
    if (nx === '\r' && s[i + 2] === '\n') { i += 2; continue; }
    if (nx === 'u') {
      const hex = s.slice(i + 2, i + 6);
      if (/^[0-9a-fA-F]{4}$/.test(hex)) { out += String.fromCharCode(parseInt(hex, 16)); i += 5; continue; }
    }
    /* a lone backslash followed by INDENTATION and more code is the model's
       broken line break — restore the newline */
    const ws = s.slice(i + 1).match(/^[ \t]+/);
    if (ws) {
      const after = s[i + 1 + ws[0].length];
      if (after !== undefined && after !== '\n' && after !== '\r') { out += '\n'; i += ws[0].length; continue; }
    }
    out += '\\' + nx; i++; continue;
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

  /* M21 — the corrupted mixed shape is checked FIRST: its stray-backslash line
     or an open triple-quoted region is direct evidence of corruption, and the
     payload can carry real newlines in enough number to defeat the
     newline-dominance gate below. The literal-`\n` requirement keeps the
     whole-body decode off an ordinary file that merely has a lone-backslash
     line or an odd number of quotes. */
  const corrupt = countOf(content, BS_N) > 0
    && (hasStrayBackslashBeforeNewline(content) || hasLoneBackslashLine(content) || hasUnterminatedTripleQuote(content) || hasBackslashBeforeIndent(content));
  if (corrupt) {
    const repaired = repairCorruptEscapes(content);
    if (repaired !== content) {
      return {
        args: { ...args, content: repaired },
        changed: true,
        reason: 'repaired-corrupt-escapes',
        stats: {
          before: { literalNl: countOf(content, BS_N), realNl: countOf(content, REAL_NL) },
          after: { literalNl: countOf(repaired, BS_N), realNl: countOf(repaired, REAL_NL) },
        },
      };
    }
  }

  if (!isDoubleEscapedPayload(content)) return { args, changed: false, reason: 'not-double-escaped' };

  /* M21 — a fully JSON-escaped body (escaped quotes/backslashes) must be
     decoded WHOLE, not just its structural separators. */
  if (isFullyJsonEscaped(content)) {
    /* A JSON string VALUE also carries its surrounding quotes; drop them so the
       file body is exactly what was encoded (`JSON.stringify(body)` round-trips). */
    let body = content;
    const t = content.trim();
    if (t.length >= 2 && t[0] === '"' && t[t.length - 1] === '"' && !t.slice(1, -1).endsWith('\\')) body = t.slice(1, -1);
    const decoded = decodeFullJsonEscapes(body);
    if (decoded !== content) {
      return {
        args: { ...args, content: decoded },
        changed: true,
        reason: 'decoded-json-string-escapes',
        stats: {
          before: { literalNl: countOf(content, BS_N), realNl: countOf(content, REAL_NL), escapedQuotes: countOf(content, '\\"') },
          after: { literalNl: countOf(decoded, BS_N), realNl: countOf(decoded, REAL_NL), escapedQuotes: countOf(decoded, '\\"') },
        },
      };
    }
  }

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

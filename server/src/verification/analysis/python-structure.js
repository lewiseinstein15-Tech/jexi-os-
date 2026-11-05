/**
 * JEXI OS — VERIFICATION — Python source structure analysis.
 *
 * M22 — the M21 measurement left a specific gap. In a Python sandbox the lint
 * layer is INAPPLICABLE (ESLint is a JavaScript linter) and the unit layer is
 * UNVERIFIABLE (an exec-style HumanEval test file cannot be run by pytest), so
 * NOTHING checked the bytes the model wrote before the turn ended. The model
 * was never told its file did not parse, and the dominant residual failures
 * were syntactic: unterminated docstrings, a body wrapped in `"""`, duplicate
 * definitions of the target function.
 *
 * This module is the cheap, PURE part of the fix: a deterministic structural
 * reader over Python source. It never claims to be a full parser — it looks for
 * the exact corruption shapes the benchmark measured, and reports each as a
 * structured, greppable signal so the verifier and the repair prompt can name
 * the defect instead of echoing a traceback.
 *
 * The shapes, all confirmed from raw M21 artifacts:
 *   - an unterminated `"""`/`'''` region (docstring never closed);
 *   - the WHOLE body wrapped in triple quotes (the model quotes the file);
 *   - a lone backslash where a line break belongs, which glues two lines
 *     together and leaves a `"""` region open;
 *   - a duplicate definition of the target function (two conflicting bodies);
 *   - a function whose body is empty or is only a placeholder
 *     (`pass`, `...`, `raise NotImplementedError`).
 *
 * The module deliberately does NOT try to reject "unusual but legal" Python:
 * it reports only these shapes, and the caller decides.
 */

const STRING_DELIMS = ['"""', "'''"];

/** Count non-overlapping occurrences of a literal delimiter. */
function countOf(haystack, needle) {
  let n = 0;
  let i = 0;
  for (;;) {
    const j = haystack.indexOf(needle, i);
    if (j < 0) break;
    n++;
    i = j + needle.length;
  }
  return n;
}

/* The stray-backslash shapes are NOT re-implemented here. They are the same
   checks the write path already uses to repair a payload, and the write-path
   versions are the tested ones (`hasLoneBackslashLine` decodes literal `\n`
   escapes first, which the naive copy omitted). Import them so the verifier
   and the repair path agree by construction. */
export { hasUnterminatedTripleQuote, hasLoneBackslashLine, hasBackslashBeforeIndent } from '../../services/agent/WritePayloadNormalizer.js';

/**
 * Does the WHOLE body sit inside one triple-quoted string?
 *
 * The model sometimes answers by quoting the file it means to write:
 *
 *     """
 *     from typing import List
 *     def f(...): ...
 *     """
 *
 * The result parses (it is one string expression) but defines nothing, so the
 * grader cannot find the function. This is different from a legitimate module
 * docstring, which is followed by real code: the signal here is that the
 * closing delimiter is the LAST non-whitespace content of the file.
 */
export function isTripleQuoteWrapped(source) {
  const s = String(source ?? '').trim();
  if (s.length < 6) return false;
  const open = STRING_DELIMS.find((d) => s.startsWith(d));
  if (!open) return false;
  if (!s.endsWith(open)) return false;
  if (countOf(s, open) !== 2) return false;
  const inner = s.slice(open.length, s.length - open.length);
  /* The inner body must actually look like code, otherwise a file that is
     genuinely one string literal is being misreported. */
  return /\b(?:def|class|import|from)\s+\w/.test(inner);
}

/**
 * Every top-level `def`/`class` name, in order, with the line it appears on.
 * Bounded to column 0 definitions so a nested function is not counted twice.
 */
export function topLevelDefs(source) {
  const s = String(source ?? '');
  const out = [];
  const re = /^(?:def|class)\s+([A-Za-z_]\w*)/gm;
  for (const m of s.matchAll(re)) {
    out.push({ kind: m[0].trimStart().startsWith('class') ? 'class' : 'def', name: m[1], line: s.slice(0, m.index).split('\n').length });
  }
  return out;
}

/** Names defined at top level more than once (conflicting bodies). */
export function duplicateTopLevelDefs(source) {
  const seen = new Map();
  for (const d of topLevelDefs(source)) seen.set(d.name, (seen.get(d.name) || 0) + 1);
  return [...seen.entries()].filter(([, n]) => n > 1).map(([name, count]) => ({ name, count }));
}

/**
 * Extract the body of a top-level `def <name>(...)`, or null when absent.
 *
 * The body is every line after the signature that is either blank or indented
 * deeper than the `def`. Bounded and line-based on purpose — the caller only
 * needs "is this body empty or a placeholder", not a full parse.
 */
export function functionBody(source, name) {
  const s = String(source ?? '');
  const lines = s.split(/\r?\n/);
  const startRe = new RegExp(`^def\\s+${name}\\s*\\(`);
  let i = lines.findIndex((l) => startRe.test(l));
  if (i < 0) return null;
  /* Skip a multi-line signature (parens still open). */
  let depth = 0;
  for (; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
    }
    if (depth <= 0) break;
  }
  const body = [];
  for (let j = i + 1; j < lines.length; j++) {
    const line = lines[j];
    if (line.trim() === '') { body.push(line); continue; }
    if (/^\s/.test(line)) { body.push(line); continue; }
    break; // dedent to column 0 — the function ended
  }
  return body.join('\n');
}

/** Is a body empty or only a placeholder statement? */
export function isPlaceholderBody(body) {
  const meaningful = String(body ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  if (!meaningful.length) return true;
  const stripped = meaningful.filter((l) => !/^("""|''')/.test(l));
  if (!stripped.length) return true;
  return stripped.every((l) => /^(?:pass|\.\.\.|raise\s+NotImplementedError\b.*|return\s+None\s*)$/.test(l));
}

/**
 * Analyse one Python source string.
 *
 * Only COMPILER-INVISIBLE defects are reported here: shapes that `ast.parse`
 * accepts but the task rejects (a whole body wrapped in a string, a duplicate
 * definition, a placeholder body). A true syntax error is the compiler's job —
 * reporting it here as well would risk false positives on legal-but-unusual
 * Python (an escaped space inside a docstring is legal, for instance).
 *
 * @param {string} source
 * @param {string|null} [entryPoint]  the function the task must define
 * @returns {{ok:boolean, defects:string[], detail:object}}
 */
export function analyzePythonSource(source, entryPoint = null) {
  const s = String(source ?? '');
  const defects = [];
  const detail = {};

  if (!s.trim()) {
    return { ok: false, defects: ['empty'], detail: { bytes: s.length } };
  }

  if (isTripleQuoteWrapped(s)) {
    defects.push('triple-quote-wrapped');
    detail.wrapped = true;
  }

  const dups = duplicateTopLevelDefs(s);
  if (dups.length) {
    defects.push('duplicate-definition');
    detail.duplicates = dups;
  }

  if (entryPoint) {
    const body = functionBody(s, entryPoint);
    if (body === null) {
      defects.push('missing-entry-point');
      detail.missingEntryPoint = entryPoint;
    } else if (isPlaceholderBody(body)) {
      defects.push('placeholder-body');
      detail.placeholderBody = true;
    }
  }

  return { ok: defects.length === 0, defects, detail };
}

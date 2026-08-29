/**
 * B176 — MATH PREPROCESSOR (the client-side root fix).
 *
 * Model lanes emit math in several dialects; remark-math understands ONLY
 * $...$ / $$...$$. This preprocessor runs on EVERY message before the
 * markdown parser (streaming, finished, and OLD history alike) and converts
 * everything to $-dialect — so raw "\\frac{d}{dx}(x^n)" never reaches the
 * screen:
 *
 *   1. PROTECT code (fenced blocks + inline `code`) — LaTeX inside code is
 *      CODE, never math.
 *   2. \\( ... \\)  → $...$          (inline LaTeX dialect)
 *      \\[ ... \\]  → $$...$$        (display LaTeX dialect)
 *   3. BARE LaTeX wrapped: a line (outside code) that contains real math
 *      commands (\\frac, \\sqrt, \\sum, \\int, \\lim, \\boxed, ^{}, _{} …)
 *      but NO $ delimiters gets its math-y segments wrapped in $...$.
 *   4. Restore code untouched.
 *
 * Pure string transforms — no HTML, no injection surface (KaTeX renders to
 * DOM with escaping; we never dangerouslySetInnerHTML math).
 */

/* Commands that mean "this is real mathematics". Ordered by specificity. */
const MATH_COMMANDS = /\\(?:frac|dfrac|tfrac|sqrt|sum|prod|int|oint|iint|lim|limsup|liminf|infty|boxed|fbox|cdot|times|div|pm|mp|leq|geq|neq|approx|equiv|rightarrow|to|leftarrow|Rightarrow|implies|iff|partial|nabla|cdot|begin|end|matrix|pmatrix|bmatrix|vmatrix|alpha|beta|gamma|delta|epsilon|varepsilon|theta|lambda|mu|pi|sigma|omega|Gamma|Delta|Theta|Lambda|Sigma|Omega|log|ln|sin|cos|tan|cot|sec|csc|arcsin|arccos|arctan|sinh|cosh|tanh|exp|min|max|sup|det|dim|ker|deg|gcd|bmod|pmod|widehat|widetilde|overline|underline|overbrace|underbrace|hat|bar|vec|dot|ddot|mathbb|mathcal|mathbf|mathrm|text|left|right|big|Big|bigg|Bigg|binom|dbinom|tbinom|substack|stackrel|overset|underset|prime|circ|bullet|star|oplus|otimes|odot|cap|cup|wedge|vee|setminus|subset|supset|subseteq|supseteq|in|notin|ni|forall|exists|nexists|emptyset|varnothing|aleph|hbar|ell|Re|Im|eth|angle|triangle|perp|parallel|simeq|asymp|propto|doteq|ll|gg|prec|succ|preceq|succeq|sim|cong|mid|nmid|qquad|quad|space|thinspace|nobreakspace|dots|ldots|cdots|vdots|ddots)\b/;


/**
 * Wrap bare LaTeX segments on ONE line (outside code) in $...$.
 * Conservative: a line is touched only when it contains a real math command
 * AND no $ delimiters already; prose words are never wrapped.
 */
function wrapBareLine(line) {
  if (line.includes('$')) return line; // already delimited — leave alone
  const m = MATH_COMMANDS.exec(line);
  if (!m || m.index === null) return line; // no real math command here
  // Simple, predictable rule: everything from the FIRST math command to the
  // end of the line is the formula (math lanes write "prefix: <formula>").
  // Prose before it stays text; the formula renders. No span walking, no
  // partial re-consumption, no mangling.
  const head = line.slice(0, m.index);
  const body = line.slice(m.index).trim();
  if (!body) return line;
  return `${head}$${body}$`;
}

/** Split-protect fenced + inline code, transform the rest, restore. */
export function preprocessMath(text) {
  const src = String(text ?? '');
  if (!src) return src;
  if (!src.includes('\\') && !/\$\$?/.test(src)) return src; // nothing mathy at all

  const stash = [];
  const keep = (s) => `\u0000M${stash.push(s) - 1}\u0000`;

  // 1) fenced code blocks ``` ... ```
  let out = src.replace(/```[\s\S]*?```/g, (m) => keep(m));
  // 2) inline code `...`
  out = out.replace(/`[^`\n]*`/g, (m) => keep(m));

  // 3) LaTeX dialect delimiters → $ dialect (multi-line bodies supported),
  //    then any LEFTOVER unclosed openers / stray closers (the model
  //    truncated, or an old history message) also become $ so the span is at
  //    least balanced instead of showing raw.
  out = out.replace(/\\\[([\s\S]*?)\\\]/g, (_, body) => `$$${body.trim()}$$`);
  out = out.replace(/\\\(([\s\S]*?)\\\)/g, (_, body) => `$${body.trim()}$`);
  // NESTED dialects: models sometimes write \[ ... $$...$$ ... \] — after
  // pair-conversion that becomes a $$-wrapped $$ body. Collapse any run of
  // 3+ dollars first, then unwrap double-wrapped display math. (Function
  // replacements only — '$' patterns in strings are escape traps.)
  out = out.replace(/\${3,}/g, (m) => (m.length % 2 === 0 ? '$$' : '$'));
  out = out.replace(/\$\$([\s\S]*?)\$\$/g, (m, b) => {
    const inner = b.trim();
    if (inner.startsWith('$$') && inner.endsWith('$$') && inner.length > 4) return inner;
    return m;
  });

  // Unclosed OPENERS (truncated/old text): wrap the remainder of the LINE
  // so the span is balanced; stray closers unwrap to plain brackets.
  out = out.replace(/\\\((.*)$/gm, (_, body) => `$${body}$`);
  out = out.replace(/\\\[(.*)$/gm, (_, body) => `$$${body}$$`);
  out = out.replace(/\\\)/g, ')').replace(/\\\]/g, ']');

  // 4) bare LaTeX per line (skip stashed markers' lines handled naturally —
  //    markers contain no backslashes)
  out = out
    .split('\n')
    .map((line) => wrapBareLine(line))
    .join('\n');

  // 5) balance guard: an odd number of $ would break the last span —
  // drop the final lone $ so everything before it still renders.
  const dollars = (out.match(/(?<!\$)\$(?!\$)/g) || []).length;
  if (dollars % 2 === 1) {
    const last = out.lastIndexOf('$');
    out = out.slice(0, last) + out.slice(last + 1);
  }

  // 6) restore code untouched
  out = out.replace(/\u0000M(\d+)\u0000/g, (_, i) => stash[Number(i)] ?? '');
  return out;
}

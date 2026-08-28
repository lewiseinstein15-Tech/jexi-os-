/**
 * JEXI OS — Response Formatting (B66, section 5).
 *
 * The orchestrator normalizes EVERY final answer before returning it to the
 * user, regardless of which coworker produced the underlying content. This
 * keeps responses consistent (headings, lists, code blocks, rendered math)
 * instead of a wall of text or inconsistent styling between workers.
 *
 * Math policy: math must NEVER surface as raw LaTeX source or garbled
 * symbols. The frontend renders `$...$` / `$$...$$` with KaTeX; this
 * normalizer guarantees the delimiters are well-formed and that solved
 * problems are presented as step-by-step worked solutions.
 */

/** Collapse runs of 3+ blank lines to one (keeps markdown sections sane). */
function collapseBlankLines(text) {
  return String(text || '').replace(/\n{3,}/g, '\n\n');
}

/** Trim trailing whitespace per line + the whole block. */
function trimLines(text) {
  return String(text || '')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .join('\n')
    .trim();
}

/**
 * Protect math: find bare `\frac`, `\sqrt`, `\sum`, `x^2`-style LaTeX that a
 * worker forgot to wrap in `$...$` and wrap each such LINE in display math
 * (`$$ ... $$`) — but NEVER inside fenced code blocks (code is full of
 * backslash-leading lines like `\n`, `\t`, `\d+`).
 */
function wrapBareLatexLines(text) {
  let inFence = false;
  return String(text || '')
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (/^```/.test(trimmed)) { inFence = !inFence; return line; }
      if (inFence) return line;
      const isBareLatex = /^\\(frac|sqrt|sum|int|lim|log|ln|sin|cos|tan|times|cdot|left|right|begin|end|alpha|beta|gamma|delta|theta|lambda|pi|infty)/.test(trimmed);
      if (isBareLatex && !trimmed.includes('$') && !trimmed.startsWith('#')) {
        return `$$ ${trimmed} $$`;
      }
      return line;
    })
    .join('\n');
}

/** Balanced-math guard: count $ signs outside code fences; if odd, drop the
 *  trailing lone delimiter so KaTeX never throws on an unclosed block. */
function balanceMathDelimiters(text) {
  let inFence = false;
  let count = 0;
  for (const line of String(text || '').split('\n')) {
    const trimmed = line.trim();
    if (/^```/.test(trimmed)) { inFence = !inFence; continue; }
    if (inFence) continue;
    for (const ch of line) if (ch === '$') count++;
  }
  if (count % 2 === 0) return text;
  // Remove the LAST bare $ outside fences.
  const lines = String(text || '').split('\n');
  let inF = false;
  for (let i = lines.length - 1; i >= 0; i--) {
    const t = lines[i].trim();
    if (/^```/.test(t)) { inF = !inF; continue; }
    if (inF) continue;
    const idx = lines[i].lastIndexOf('$');
    if (idx !== -1) {
      lines[i] = lines[i].slice(0, idx) + lines[i].slice(idx + 1);
      break;
    }
  }
  return lines.join('\n');
}

/**
 * Normalize a coworker's raw output into a clean, consistent final answer.
 * Structural only — never rewrites the model's content or facts.
 */
export function normalizeFinalAnswer(text) { // B66
  if (!text || !String(text).trim()) return '';
  let out = String(text);
  out = collapseBlankLines(out);
  out = wrapBareLatexLines(out);
  out = balanceMathDelimiters(out);
  out = trimLines(out);
  return out;
}

/** System-prompt appendix that keeps workers' output format-consistent. */
export const FORMAT_RULES = `
RESPONSE FORMAT (mandatory, always):
- Use markdown: ## headings for sections, bullet lists for enumerations, and fenced code blocks for code.
- MATH: present solved problems as a clear WORKED SOLUTION — step-by-step working, not just a final answer.
  Use $...$ for inline math and $$...$$ for display math. Never output raw LaTeX commands without $ delimiters.
- Keep paragraphs short; avoid walls of text.

PRESENTER CONTRACT (how answers are DISPLAYED — the UI renders all of these):
- Numbers: compare quantities in a markdown TABLE with thousand separators. Never dump raw lists of numbers.
- Formulas: ALWAYS $...$ / $$...$$ LaTeX (the app renders real math).
- Data/trends/percentages/comparisons → output a REAL GRAPH the user can SEE:
  \`\`\`chart
  {"type":"bar"|"line"|"pie","title":"...","unit":"...","data":{"Label":123,...}}
  \`\`\`
  Keep ≤10 bars; values must be real numbers from your answer.
- Processes/architecture/flows → a \`\`\`mermaid diagram (flowchart/graph/sequence).
- "Show me / what does X look like" → call the image_search tool and embed results as ![title](thumbnail-url).
- Explain every graph/diagram in one short sentence under it.`;

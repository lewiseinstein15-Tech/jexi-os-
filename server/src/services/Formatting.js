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
/**
 * B174c — MATH DELIMITER NORMALIZER. Some model lanes emit LaTeX with
 * \( ... \) / \[ ... \] delimiters, which remark-math does NOT parse —
 * the UI showed raw \frac{2}{3} garbage. Convert both forms to $ / $$ so
 * EVERY math style renders. Applied centrally: stream releases, think text
 * and done summaries all pass through this.
 */
export function normalizeMathDelimiters(text) {
  let out = String(text || '');
  if (!out.includes('\\(') && !out.includes('\\[')) return out;
  out = out.replace(/\\\[([\s\S]*?)\\\]/g, (_, body) => `$$\n${String(body).trim()}\n$$`);
  out = out.replace(/\\\(([\s\S]*?)\\\)/g, (_, body) => `$${String(body).trim()}$`);
  return out;
}

export function normalizeFinalAnswer(text) { // B66
  if (!text || !String(text).trim()) return '';
  let out = String(text);
  out = collapseBlankLines(out);
  out = normalizeMathDelimiters(out); // B174c — \( \) / \[ \] → $ / $$
  out = wrapBareLatexLines(out);
  out = balanceMathDelimiters(out);
  out = trimLines(out);
  return out;
}

/** System-prompt appendix that keeps workers' output format-consistent. */
export const FORMAT_RULES = `
RESPONSE FORMAT (mandatory, always):
- LINKS: NEVER output localhost / 127.0.0.1 / 192.168.x / internal-port links — the user is on a phone and those never load. For built apps use the RELATIVE preview path exactly as the build system provides (e.g. /preview/index.html). If you only ran a local server to test, SAY SO and give the relative preview link instead of the localhost URL. Never claim a link is "verified" unless it is a public/relative one.
- ACT, DON'T ASK: when the user's follow-up makes the next step obvious ("give me the link" → produce/link the web version; "again" → redo it), DO it immediately. Only ask a clarifying question when the request is genuinely ambiguous.
- NATURAL TONE: you are JEXI, a warm human-like assistant — NOT a report generator. For short replies (greetings, yes/no, quick facts) answer in 1-2 plain sentences with NO heading, NO title, NO sections. Only use headings when the answer is genuinely long/structured (worked math, tutorials, reports). Never title a reply with what the user asked ("## User Greeting", "## Response") — just answer.
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

/* ══════════════════ B174 — MATH-SAFE STREAM BUFFER ══════════════════
 * Live answers used to show HALF-TYPED LaTeX ("\\frac{\\te…") — unreadable.
 * dsh streams structured blocks that only surface when complete; this is the
 * text equivalent for math: an incomplete $ span (or a trailing \\command)
 * is held back until it closes, then released whole. The answer still types
 * live — formulas just arrive finished and render properly. */
export function createMathStreamBuffer() {
  let buf = '';
  let emitted = 0;
  /** Exact scan: the safe cut is the end of the last CLOSED math span.
   *  Handles $inline$ AND $$display$$ (a display block stays held until its
   *  closing $$ lands — nothing raw ever shows mid-block), skips \\$ escapes. */
  function safeLen() {
    let safe = buf.length;
    let open = null;       // '$' | '$$' | null
    let openStart = -1;
    for (let i = 0; i < buf.length; i++) {
      const c = buf[i];
      if (c === '\\') { i++; continue; } // skip escaped char (incl. \$)
      if (c === '$') {
        const disp = buf[i + 1] === '$';
        if (open === null) { open = disp ? '$$' : '$'; openStart = i; i += disp ? 1 : 0; }
        else if (open === '$$' && disp) { open = null; i += 1; }
        else if (open === '$' && !disp) { open = null; }
        // $ inside $$-block or $$ inside $-span: treat as content, keep scanning
      }
    }
    if (open !== null && openStart >= 0) safe = Math.min(safe, openStart);
    const m = /[\\][a-zA-Z]{0,11}$/.exec(buf);
    if (m && m.index >= emitted) safe = Math.min(safe, m.index);
    return Math.max(emitted, Math.min(buf.length, safe));
  }
  return {
    /** Feed one delta → the text safe to emit now (possibly '').
     *  B176: the delta is FIRST normalized from \( \)/\[ \] dialect to
     *  $ dialect, so non-$ openers stream through the SAME hold-back logic
     *  (raw `\(\frac{d}{dx}` never shows mid-stream). Trailing lone
     *  backslashes are held by the existing command-tail rule, so a
     *  delimiter split across chunks waits for its other half. */
    push(delta) {
      // pair-normalize, then convert any LEFTOVER (still-unclosed) \( / \[
      // openers and stray closers to $ / $$ so the span scanner holds them
      // exactly like native $ spans — raw LaTeX never emits mid-stream.
      buf += normalizeMathDelimiters(String(delta || ''))
        .replace(/\\\(/g, '$')
        .replace(/\\\[/g, '$$')
        .replace(/\\\)/g, '$')
        .replace(/\\\]/g, '$$');
      const safe = safeLen();
      const out = buf.slice(emitted, safe);
      emitted = safe;
      return out;
    },
    /** Release everything held (call before the final event). */
    flush() {
      const out = buf.slice(emitted);
      emitted = buf.length;
      return out;
    },
  };
}

/* ══════════════════ B187 — LINK SANITIZER (no localhost to users) ══════════════════
 * The user got http://localhost:5173/preview/... links that can never work on
 * a phone (they point at the SERVER's own machine). Every outgoing summary is
 * rewritten: localhost/127.0.0.1/private IPs → the public brain base URL. If
 * the target file does not exist in the workspace, point at the closest
 * servable HTML file instead — a dead link is never acceptable. */
const LOCAL_RE = new RegExp('https?:\\/\\/(?:localhost|127\\.0\\.0\\.1|0\\.0\\.0\\.0|\\[::1\\]|10\\.\\d+\\.\\d+\\.\\d+|172\\.(?:1[6-9]|2\\d|3[01])\\.\\d+\\.\\d+|192\\.168\\.\\d+\\.\\d+)(?::\\d+)?(?:\\/[^\\s)\\]]*)?', 'gi');

export function sanitizeOutgoingLinks(text, publicBase, { existsInWorkspace = null } = {}) {
  const base = String(publicBase || '').replace(/\/$/, '');
  if (!base) return String(text || ''); // no public base known — leave as-is
  return String(text || '').replace(LOCAL_RE, (m) => {
    // split off the path after the host[:port] — keep ONLY the path part
    const after = m.replace(/^https?:\/\/[^/]+/, ''); // '' or '/xxx'
    const path = after.startsWith('/') ? after : '/';
    return `${base}${path}`;
  });
}

/** Best-effort: pick the closest servable workspace file for a dead link. */
export function rescueDeadPreviewLink(url, { listWorkspaceFiles = null } = {}) {
  try {
    const u = new URL(url);
    const name = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
    if (!listWorkspaceFiles) return null;
    const files = listWorkspaceFiles();
    if (files.some((f) => f === name)) return name;
    const stem = name.replace(/\.[^.]+$/, '');
    const hit = files.find((f) => f.startsWith(stem)) || files.find((f) => /^index\.html$/i.test(f));
    return hit || null;
  } catch { return null; }
}

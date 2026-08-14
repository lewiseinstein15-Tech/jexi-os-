/**
 * JEXI OS — Answer Sanitizer (B51 P1/P7).
 *
 * A last-line-of-defense post-processor for user-facing summaries. The
 * Orchestrator nodes were fixed to never build process-narration headers, and
 * the system prompt forbids the phrases — but this sanitizer guarantees it:
 * anything that still leaks through is stripped before the responder ships it.
 *
 * It removes whole lines/blocks that are pure narration (e.g. a
 * "### 📚 JEXI SCHOLAR" header, a "I studied … saved it …" paragraph) and
 * deletes forbidden phrases inline, then collapses the leftover blank space.
 * Legitimate content that merely contains a forbidden word is never touched.
 */

const FORBIDDEN_PHRASES = [
  /I studied /gi,
  /I have studied /gi,
  /I researched /gi,
  /I have researched /gi,
  /I used the Trusted Library/gi,
  /using the Trusted Library/gi,
  /from the Trusted Library/gi,
  /the Trusted Library \(/gi,
  /I saved (this|it) to my knowledge library/gi,
  /saved it to my knowledge library/gi,
  /saved to my knowledge library/gi,
  /I remember (this|that) from memory/gi,
  /I found (this|it) in your books/gi,
  /found it in your (books|library)/gi,
  /According to my knowledge library/gi,
  /I solved this before/gi,
  /I solved this earlier/gi,
  /I already solved this/gi,
  /as an AI( language model)?[,.]/gi,
  /as a language model[,.]/gi,
  /I will now /gi,
];

/** Headers / banners that are pure process narration — remove the whole line.
 * NOTE: emoji bullets are matched via \p{Extended_Pictographic} (u flag) — a
 * literal emoji character class matches UTF-16 code units and never hits. */
const NARRATION_HEADER_RE = /^\s*(#{1,6}\s*)?(?:\p{Extended_Pictographic}\s*)?(JEXI SCHOLAR|FROM MEMORY|RECALLED FROM MEMORY|FROM YOUR BOOKS|JEXI TEAM — PLANNED, BUILT, TESTED & SHIPPED|JEXI OS — FROM MEMORY[^\n]*)\s*$/gimu;

/** Whole-line narration paragraphs (with optional leading bullet/dash/emoji). */
const NARRATION_LINE_RE = /^\s*(?:\p{Extended_Pictographic}\s*)?(?:[-*>]\s*)?(I studied [^\n]+|I researched [^\n]+|I used the Trusted Library[^\n]*|I saved (this|it) to my knowledge library[^\n]*|I remember this from memory[^\n]*|I found (this|it) in your books[^\n]*|The full agent team worked together[^\n]*|I solved this before[^\n]*)\s*$/gimu;

/**
 * Strip forbidden narration from a final answer.
 * @param {string} text
 * @returns {string} cleaned text (whitespace-collapsed).
 */
export function sanitizeFinalAnswer(text) {
  if (!text || typeof text !== 'string') return text;
  let out = text;

  // 1. Remove pure-narration header lines and paragraphs.
  out = out.replace(NARRATION_HEADER_RE, '');
  out = out.replace(NARRATION_LINE_RE, '');

  // 2. Remove forbidden phrases inline (keeps surrounding content intact).
  for (const re of FORBIDDEN_PHRASES) {
    out = out.replace(re, '');
  }

  // 3. Collapse the blank space the removals left behind.
  out = out.replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s+/, '')
    .replace(/\s+$/, '');

  return out;
}

/** True when the text contains any forbidden narration phrase (for tests). */
export function containsForbiddenNarration(text) {
  const t = String(text || '');
  if (NARRATION_HEADER_RE.test(t)) return true;
  if (NARRATION_LINE_RE.test(t)) return true;
  return FORBIDDEN_PHRASES.some((re) => re.test(t));
}

/** The list of forbidden phrases for tests / documentation. */
export const FORBIDDEN_NARRATION_PATTERNS = FORBIDDEN_PHRASES;

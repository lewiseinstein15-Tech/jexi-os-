/**
 * B109 — DSH-FIDELITY PORT of `@deepseek-ai/dsh-session-title/normalize`:
 * title sanitization is byte-safe and terminal-safe exactly like DSH.
 *
 * DSH strips OS command escapes (OSC/CSI/ESC), C0/C1 control characters and
 * directional/invisible controls; collapses whitespace; truncates by UTF-8
 * BYTES without splitting code points; and derives the deterministic
 * fallback from the leading WORDS of the first eligible human message
 * (word cap + byte cap), not the whole sentence.
 */

/** OS-command escape sequences, including unterminated tails. */
const OSC_SEQUENCE = /(?:\u001B\]|\u009D)(?:(?!\u0007|\u001B\\)[\s\S])*(?:\u0007|\u001B\\|$)/gu;
/** Control-sequence-introducer escapes such as SGR color codes. */
const CSI_SEQUENCE = /(?:\u001B\[|\u009B)[0-?]*[ -/]*[@-~]/gu;
/** Remaining two-byte ESC control sequences. */
const ESC_SEQUENCE = /\u001B[@-_]/gu;
/** Non-whitespace C0/C1 control characters. */
const CONTROL_CHARACTER = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/gu;
/** Directional and invisible controls that can make a displayed title deceptive. */
const DIRECTIONAL_CONTROL = /[\u200B\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF]/gu;

/** Remove controls and produce one trimmed, whitespace-normalized line (DSH cleanTitleText). */
export function cleanTitleText(input) {
  return String(input || '')
    .replace(OSC_SEQUENCE, '')
    .replace(CSI_SEQUENCE, '')
    .replace(ESC_SEQUENCE, '')
    .replace(CONTROL_CHARACTER, '')
    .replace(DIRECTIONAL_CONTROL, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

/** Truncate to a UTF-8 byte budget without splitting a code point (DSH truncateTitleUtf8). */
export function truncateTitleUtf8(input, maxBytes) {
  const budget = Math.max(1, Number(maxBytes) || 1);
  if (Buffer.byteLength(input, 'utf8') <= budget) return input;
  let used = 0;
  let output = '';
  for (const character of input) {
    const bytes = Buffer.byteLength(character, 'utf8');
    if (used + bytes > budget) break;
    output += character;
    used += bytes;
  }
  return output;
}

/** Normalize one accepted title and enforce its UTF-8 byte budget (DSH normalizeSessionTitle). */
export function normalizeSessionTitle(input, maxBytes) {
  return truncateTitleUtf8(cleanTitleText(input), maxBytes).trimEnd();
}

/** Deterministic first-prompt fallback: leading words within both limits (DSH fallbackSessionTitle). */
export function fallbackSessionTitle(input, maxWords = 8, maxBytes = 80) {
  const words = cleanTitleText(input).split(' ').filter(Boolean).slice(0, Math.max(1, Number(maxWords) || 1));
  return truncateTitleUtf8(words.join(' '), maxBytes).trimEnd();
}

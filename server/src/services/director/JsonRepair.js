/**
 * B209 — JSON REPAIR: free-tier model lanes emit structurally-complete but
 * syntactically-sloppy JSON (markdown **bold** inside string values, raw
 * newlines/tabs inside literals, trailing commas, truncated tails). The
 * strict parser returns null and the whole Director turn declined — this
 * module salvages those responses instead of throwing the work away.
 *
 * Every repair is conservative and logged-in-mind: nothing is invented,
 * only syntax noise is cleaned. If the result still doesn't parse, we
 * return null and the caller's honesty path stays intact.
 */

/** Strip markdown emphasis markers anywhere (they only pollute values). */
function stripMarkdownEmphasis(t) {
  return t.replace(/\*\*/g, '').replace(/(^|[^*])\*([^*\n]+)\*(?=[^*]|$)/g, '$1$2');
}

/**
 * Walk the text with string-awareness:
 *  - raw control characters (incl. newlines/tabs) inside string literals
 *    become escaped or blanked (JSON forbids them raw)
 *  - trailing commas before } or ] are dropped
 */
function cleanStringLiterals(t) {
  let out = '';
  let inStr = false;
  let esc = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (esc) { out += c; esc = false; continue; } // escaped char inside string — keep
    if (inStr) {
      if (c === '\\') { out += c; esc = true; continue; }
      if (c === '"') { inStr = false; out += c; continue; }
      if (c === '\n' || c === '\r') { out += '\\n'; continue; } // raw newline inside a literal
      if (c === '\t') { out += '\\t'; continue; }
      if (c.charCodeAt(0) < 32) { out += ' '; continue; } // other control chars
      out += c;
      continue;
    }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === ',' ) {
      // trailing comma before a closer (allow whitespace/comments-free gap)
      const rest = t.slice(i + 1);
      const m = rest.match(/^\s*([}\]])/);
      if (m) { continue; } // drop the comma
    }
    out += c;
  }
  return out;
}

/** Balance a truncated JSON object/array tail (best-effort, no invention). */
function balanceTruncated(t) {
  let inStr = false; let esc = false;
  const stack = [];
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (esc) { esc = false; continue; }
    if (inStr) { if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') stack.push(c);
    else if (c === '}' || c === ']') stack.pop();
  }
  if (!stack.length) return t;
  // if we ended inside a string, close it first
  let fixed = inStr ? t + '"' : t;
  // drop a dangling partial key/value tail after the last complete element
  const lastComma = Math.max(fixed.lastIndexOf(','), fixed.lastIndexOf('{'), fixed.lastIndexOf('['));
  if (inStr || /[:,]\s*$/.test(fixed)) {
    const cut = fixed.slice(0, lastComma + 1);
    if (cut.length < fixed.length) fixed = cut.replace(/[,:]\s*$/, '');
  }
  let tail = '';
  for (let i = stack.length - 1; i >= 0; i--) tail += stack[i] === '{' ? '}' : ']';
  return fixed + tail;
}

/**
 * Parse model JSON leniently: strict first, then progressively repaired.
 * @returns {object|null}
 */
export function parseModelJson(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const attempts = [];
  // 0) strict
  attempts.push(raw);
  // 1) fenced or braced slice (as before)
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : raw;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start !== -1 && end > start) attempts.push(body.slice(start, end + 1));
  if (start !== -1) attempts.push(body.slice(start)); // maybe truncated
  // 2) repaired variants of each candidate
  for (const candidate of [...attempts]) {
    const base = cleanStringLiterals(stripMarkdownEmphasis(candidate));
    attempts.push(base);
    attempts.push(balanceTruncated(base));
    // 3) value tails: '"key": "value" stray words,' → the words join the value
    attempts.push(base.replace(/(:\s*)\"([^\"\n]*)\"([^\"\n:]*?),/g, '$1\"$2$3",'));
    // 4) a truncated last array element is DROPPED (never half-invented)
    attempts.push(base.replace(/,\s*\{[^{}]*$/, ''));
    attempts.push(balanceTruncated(base.replace(/,\s*\{[^{}]*$/, '')));
  }
  for (const candidate of attempts) {
    try {
      const v = JSON.parse(candidate);
      if (v && typeof v === 'object') return v;
    } catch { /* next attempt */ }
  }
  return null;
}

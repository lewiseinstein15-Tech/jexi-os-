/**
 * JEXI TUI — secret redaction.
 *
 * A backstop, not the primary defence: the backend already masks model ids and
 * sanitizes its own output. But a tool result can echo a key the model read
 * from a file, and a local error message can quote a URL with a token in it.
 * Anything on its way to the transcript passes through here first, so a secret
 * that leaks into a stream never gets stored in the transcript or painted on
 * the screen.
 *
 * Pure and total: every function returns a string and never throws. The
 * patterns are deliberately conservative — they must not mangle ordinary text
 * like "monkey" or a bare 40-char hash in prose.
 */

/** Ordered rules: each is [regex, replacement]. First match wins per rule. */
const RULES = [
  // GitHub tokens: ghp_/gho_/ghu_/ghs_/ghr_ + 36 chars; fine-grained pat_.
  [/\b(gh[pousr]_[A-Za-z0-9]{20,})/g, '[redacted:github-token]'],
  [/\b(github_pat_[A-Za-z0-9_]{20,})/g, '[redacted:github-pat]'],
  // OpenAI-style and generic sk- keys.
  [/\bsk-[A-Za-z0-9_-]{16,}/g, '[redacted:api-key]'],
  // AWS access key ids.
  [/\b(AKIA|ASIA)[0-9A-Z]{16}\b/g, '[redacted:aws-key]'],
  // Slack tokens.
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/g, '[redacted:slack-token]'],
  // Google API keys.
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, '[redacted:google-key]'],
  // Authorization headers / bearer tokens.
  [/\b(bearer)\s+[A-Za-z0-9._~+/-]{16,}=*/gi, 'Bearer [redacted]'],
  // Credentials embedded in a URL: scheme://user:pass@host
  [/([a-z][a-z0-9+.-]*:\/\/)([^\s/@:]+):([^\s/@]+)@/gi, '$1[redacted]@'],
  // key=value / key: value where the key names a secret.
  [
    /\b((?:api[_-]?key|secret|password|passwd|access[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?key|refresh[_-]?token))\b(\s*[:=]\s*)("?)([^\s"'`,;]{6,})\3/gi,
    '$1$2$3[redacted]$3',
  ],
  // PEM private key blocks (multi-line).
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[redacted:private-key]'],
];

/**
 * Redact every secret-shaped substring in `text`.
 * @param {unknown} text
 * @returns {string}
 */
export function redact(text) {
  if (text == null) return '';
  let s = typeof text === 'string' ? text : String(text);
  for (const [re, rep] of RULES) {
    try { s = s.replace(re, rep); } catch { /* a bad rule must never throw */ }
  }
  return s;
}

/**
 * Redact the string fields of a shallow event/payload object, returning a copy.
 * Nested objects are copied one level deep (the shapes the TUI receives are
 * flat); anything deeper is stringified then redacted, so nothing bypasses.
 */
export function redactEvent(evt) {
  if (!evt || typeof evt !== 'object') return evt;
  const out = Array.isArray(evt) ? [] : {};
  for (const [k, v] of Object.entries(evt)) {
    if (typeof v === 'string') out[k] = redact(v);
    else if (v && typeof v === 'object') out[k] = redactEvent(v);
    else out[k] = v;
  }
  return out;
}

/** Does this string contain something that WOULD be redacted? */
export function hasSecret(text) {
  return redact(text) !== String(text == null ? '' : text);
}

export default { redact, redactEvent, hasSecret };

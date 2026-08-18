/**
 * B132 — TOKEN METER (DeepSeek Harness `packages/llm/token-meter` mirror).
 *
 * A deterministic estimate of the tokens in a text (mix of chars/4 and
 * word-aware counting) so compaction pressure and telemetry use a real
 * token figure instead of a raw char count.
 */

/** Estimate tokens in text (no external tokenizer — offline, deterministic). */
export function estimateTokens(text) {
  const s = String(text || '');
  if (!s) return 0;
  const chars = s.length;
  const words = s.trim().split(/\s+/).filter(Boolean).length;
  // ~4 chars/token for English; word count / 0.75 ≈ tokens; blend.
  const byChars = chars / 4;
  const byWords = words * 1.35;
  return Math.max(1, Math.round((byChars * 0.6 + byWords * 0.4)));
}

/** Estimate for an array of messages [{role, text}]. */
export function estimateMessagesTokens(messages = []) {
  let total = 0;
  for (const m of messages) total += estimateTokens((m && (m.text || m.content)) || '');
  return total;
}

/** Token budget sanity helper: true when estimate is under the cap. */
export function underTokenBudget(text, capTokens = 28000) {
  return estimateTokens(text) <= capTokens;
}

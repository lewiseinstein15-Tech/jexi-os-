/**
 * JEXI OS — Phase 22 Scope A — CLAUDE MEM: session observation injection.
 *
 * Pattern (thedotmack/claude-mem): a new session gets the observations that
 * are RELEVANT to what it is about to do, capped by a token budget — the
 * compacted past is injected, not the raw transcript.
 *
 * Injection reads the observations compressed by ./session-compress.js
 * straight off disk (.jexi/session-mem/<id>.obs.json), so it works across
 * process boundaries and after a SIGKILL.
 *
 * Relevance is RULE-BASED (token overlap + concept/file/type boosts) and
 * deterministic: scores are integers, ties break on a stable key. Label:
 * "rule-based - LLM ranking NOT VERIFIED" (upstream ranks with an LLM).
 */
import { readObservations, estimateTokens, CHARS_PER_TOKEN_ESTIMATE } from './session-compress.js';

export const RANKING_MODE = 'rule-based';
export const LLM_RANKING_LABEL = 'rule-based - LLM ranking NOT VERIFIED';
export const DEFAULT_TOKEN_BUDGET = 1200;

const STOP = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'was', 'were', 'are',
  'not', 'but', 'you', 'your', 'its', 'it', 'a', 'an', 'of', 'to', 'in', 'on', 'is',
]);

/** Deterministic identifier/path/number tokens plus lowercased words > 2 chars. */
export function tokenize(text) {
  return String(text ?? '').toLowerCase()
    .split(/[^a-z0-9_./-]+/)
    .map((t) => t.replace(/^[./-]+|[./-]+$/g, ''))
    .filter((t) => t.length > 2 && !STOP.has(t));
}

function overlap(queryTokens, haystack) {
  const hay = new Set(tokenize(haystack));
  let hits = 0;
  for (const t of new Set(queryTokens)) if (hay.has(t)) hits += 1;
  return hits;
}

/** Integer score — no floats, so no floating-point tie ambiguity. */
export function scoreObservation(obs, queryTokens) {
  let score = 0;
  score += 6 * overlap(queryTokens, obs.title || '');
  score += 3 * overlap(queryTokens, obs.narrative || '');
  score += 3 * overlap(queryTokens, obs.facts || '');
  score += 4 * overlap(queryTokens, obs.concepts || '');
  score += 5 * overlap(queryTokens, `${obs.files_read || ''} ${obs.files_modified || ''}`);
  score += 2 * overlap(queryTokens, obs.type || '');
  return score;
}

function render(obs) {
  const files = obs.files_modified ? `files_modified: ${obs.files_modified}`
    : obs.files_read ? `files_read: ${obs.files_read}` : null;
  return [
    `[${obs.type}] ${obs.title}`,
    obs.facts ? `facts: ${obs.facts}` : null,
    files,
    obs.concepts ? `concepts: ${obs.concepts}` : null,
  ].filter(Boolean).join('\n');
}

/**
 * inject(sessionId, query, { tokenBudget }) -> { observations, tokens, ... }
 *
 * Returns the highest-scoring observations that fit the budget (best-first
 * greedy packing — always deterministic). `tokens` is the estimated token
 * count of what was returned. Hitting the budget stops injection; it never
 * partially includes an observation.
 */
export function inject(sessionId, query, { tokenBudget = DEFAULT_TOKEN_BUDGET } = {}) {
  const stored = readObservations(sessionId);
  const all = stored?.observations ?? [];
  const queryTokens = tokenize(query);

  const ranked = all
    .map((obs) => ({ obs, score: scoreObservation(obs, queryTokens) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => (b.score - a.score)
      || (b.obs.created_at_epoch - a.obs.created_at_epoch)
      || String(a.obs.id).localeCompare(String(b.obs.id)));

  const selected = [];
  let tokens = 0;
  for (const { obs, score } of ranked) {
    const cost = estimateTokens(render(obs));
    if (tokens + cost > tokenBudget) continue; // skip; a smaller observation may still fit
    selected.push({ ...obs, relevance: score });
    tokens += cost;
  }

  return {
    observations: selected,
    tokens,
    tokenBudget,
    considered: all.length,
    matched: ranked.length,
    ranking_mode: RANKING_MODE,
    label: LLM_RANKING_LABEL,
    chars_per_token_estimate: CHARS_PER_TOKEN_ESTIMATE,
    query: String(query ?? ''),
    session_id: sessionId,
  };
}

export default { inject, scoreObservation, tokenize };
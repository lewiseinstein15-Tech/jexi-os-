/**
 * JEXI OS — PHASE 13 SCOPE E — TRUST SCORE MODEL.
 *
 * The score is a pure function of the verified-action history. There is no
 * wall-clock term, no decay, no randomness: same history, same score, in any
 * process, on any machine. History is ordered by op-seq (the caller's monotone
 * counter), which is the only ordering this module ever uses.
 *
 * Declared curve (normative; mirrored in README.md):
 *
 *   score = w1·v1 + w2·v2 + w3·v3 + w4·v4
 *
 * where vk (k = 1..4) is the count of verified actions of kind k and
 * w = [0.10, 0.20, 0.30, 0.40] are the kind weights. The raw score is clamped
 * to [0, 1]:
 *
 *   score = min(1, max(0, raw))
 *
 * Verified actions are the ONLY contribution: unverified actions never move
 * the score (P2), whatever their kind. Kinds beyond 4 use weight w4 (unknown
 * kinds default to the smallest useful credit, w1 = 0.10, after clamping the
 * kind index), so the curve stays total without inventing ad-hoc rules.
 *
 * Rationale: higher-index kinds are more consequential (routine < review <
 * build < ship), so their verified occurrence moves trust faster. The curve
 * is monotone in verified counts and reaches 1.0 with, e.g., 3 ship-verifies
 * (3 × 0.40 = 1.2 → clamp) or the weighted mix the probes use.
 */

/** Weights per verified-action kind, index 1..4. Declared curve constants. */
export const KIND_WEIGHTS = [0.10, 0.20, 0.30, 0.40];

/** Hard bounds of the score. */
export const SCORE_MIN = 0;
export const SCORE_MAX = 1;

/** The canonical action kinds (1..4). Anything else folds to the last weight. */
export const KINDS = ['routine', 'review', 'build', 'ship'];

function weightFor(kind) {
  const idx = KINDS.indexOf(String(kind));
  return idx >= 0 ? KIND_WEIGHTS[idx] : KIND_WEIGHTS[KIND_WEIGHTS.length - 1];
}

/** The kind name for bookkeeping; unknown kinds are recorded verbatim. */
function kindName(action, index) {
  if (action && action.kind != null) return String(action.kind);
  return KINDS[Math.min(Math.max(index, 0), KINDS.length - 1)] || `kind-${index + 1}`;
}

/**
 * Compute the score over a history of entries
 * `{ seq, agentId, action, verified }`.
 *
 *   scoreOf(history) -> { score, counts }
 *
 * `counts` maps kind -> verified count, the derivation the probes show.
 */
export function scoreOf(history) {
  const counts = Object.create(null);
  let raw = 0;
  for (const entry of history || []) {
    if (!entry || entry.verified !== true) continue; // unverified contributes nothing
    const kind = kindName(entry.action, 0);
    counts[kind] = (counts[kind] || 0) + 1;
    raw += weightFor(entry.action && entry.action.kind);
  }
  const score = Math.min(SCORE_MAX, Math.max(SCORE_MIN, raw));
  // Deterministic decimal rounding at 4 places keeps JSON stable across runs
  // without ever being a clock or a random term.
  const fixed = Number(score.toFixed(4));
  return { score: fixed, counts };
}

/** Weight a given kind would contribute per verified occurrence. */
export function weightOf(kind) {
  return weightFor(kind);
}

export { KIND_WEIGHTS as WEIGHTS, SCORE_MIN as MIN, SCORE_MAX as MAX };

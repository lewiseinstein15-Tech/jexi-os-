/**
 * JEXI OS — Phase 26 Scope F — TTL policy (op-seq delta, NO clocks).
 *
 * DECLARED DEFAULTS:
 *   DEFAULT_TTL           = 100 op-seq
 *   DEFAULT_MIN_CONFIDENCE = 0.5
 *
 * DECLARED STALENESS RULE — an instinct is prunable iff BOTH hold:
 *   (currentOpSeq - instinct.lastSeenAt) > ttl      (stale)
 *   AND instinct.confidence < minConfidence          (weak)
 * Neither condition alone ever removes an instinct.
 */
import { fail } from '../../semantica/_internal.js';

export const DEFAULT_TTL = 100;
export const DEFAULT_MIN_CONFIDENCE = 0.5;

export function resolveOpts({ ttl, minConfidence } = {}) {
  const t = ttl === undefined ? DEFAULT_TTL : ttl;
  const m = minConfidence === undefined ? DEFAULT_MIN_CONFIDENCE : minConfidence;
  if (typeof t !== 'number' || !Number.isInteger(t) || t < 0) {
    throw fail('E_INVALID_TTL', 'ttl must be an integer >= 0 (op-seq delta), got ' + JSON.stringify(ttl));
  }
  if (typeof m !== 'number' || m < 0 || m > 1) {
    throw fail('E_INVALID_MIN_CONFIDENCE', 'minConfidence must be a number in [0, 1], got ' + JSON.stringify(minConfidence));
  }
  return { ttl: t, minConfidence: m };
}

export function isStale(currentOp, instinct, { ttl, minConfidence }) {
  const age = currentOp - instinct.lastSeenAt;
  return { stale: age > ttl && instinct.confidence < minConfidence, age };
}

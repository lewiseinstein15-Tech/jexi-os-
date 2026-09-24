/**
 * JEXI OS — Phase 28 Scope D — hybrid retrieval: hyperbolic recency decay.
 *
 * gbrain recency-decay.ts pattern: per-slug-prefix coefficients, longest
 * prefix match wins; factor = coef * halflife / (halflife + days).
 * Deterministic; config injected (declared defaults below).
 */
import { SemanticaError } from '../../../services/semantica/_internal.js';

/** Declared defaults (days). Longer prefixes override shorter ones. */
export const DEFAULT_RECENCY = Object.freeze({
  '': { coef: 1.0, halflifeDays: 180 },
});

/** Longest-prefix match for a pageId against the config. */
export function matchPrefix(pageId, config) {
  let best = '';
  for (const prefix of Object.keys(config)) {
    if (pageId.startsWith(prefix) && prefix.length > best.length) best = prefix;
  }
  if (best === '' && !('' in config)) {
    throw new SemanticaError('E_INVALID_ARGUMENT', 'recency config must include a "" default prefix');
  }
  return best;
}

/** factor = coef * halflife / (halflife + days). */
export function decayFactor({ coef, halflifeDays }, days) {
  if (!(halflifeDays > 0)) throw new SemanticaError('E_INVALID_ARGUMENT', `halflifeDays must be > 0, got ${halflifeDays}`);
  const d = Math.max(0, days);
  return coef * halflifeDays / (halflifeDays + d);
}

/**
 * applyRecency(cands, { config, now }) -> cands with score*=factor and a
 * reason per candidate. cands: [{ pageId, updated_at, score, reasons[] }].
 */
export function applyRecency(cands, { config = DEFAULT_RECENCY, now }) {
  if (typeof now !== 'string') throw new SemanticaError('E_INVALID_ARGUMENT', 'applyRecency: now (ISO UTC) is required — no hidden clocks');
  const nowMs = Date.parse(now);
  return cands.map((c) => {
    const prefix = matchPrefix(c.pageId, config);
    const { coef, halflifeDays } = config[prefix];
    const days = Math.max(0, (nowMs - Date.parse(c.updated_at)) / 86400000);
    const factor = decayFactor({ coef, halflifeDays }, days);
    return {
      ...c,
      score: c.score * factor,
      reasons: [...c.reasons, `recency-decay(prefix="${prefix}", halflife=${halflifeDays}d, days=${Math.round(days)}, factor=${factor.toFixed(4)})`],
    };
  });
}

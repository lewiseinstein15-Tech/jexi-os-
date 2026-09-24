/**
 * JEXI OS — Phase 15 Scope D — selection (fitness rules).
 *
 * Fitness is a WEIGHTED, EXPLICIT rule — never a fabricated number:
 *
 *   base                     0.40  always
 *   direction                +0.30 if `to` is closer to the schema
 *                                   midpoint than `from`
 *                            -0.20 if it moves further away
 *                              0.00 otherwise / non-numeric genes
 *   small-change             +0.20 if |to - from| <= 10% of the
 *                                   schema range (non-numeric: +0.20
 *                                   for any set-delta, capped)
 *   valid-live-gene          +0.10 if the current live value itself
 *                                   validates against the schema
 *
 *   total clamped to [0, 1]; threshold 0.60 -> promoted: true/false
 */
import { validate } from './genes.js';

export const THRESHOLD = 0.6;

export const FITNESS_RULE = {
  base: 0.4,
  direction: { closer: 0.3, further: -0.2, same: 0 },
  smallChange: { bonus: 0.2, maxRangeFraction: 0.1 },
  validLive: 0.1,
  threshold: THRESHOLD,
};

export function computeFitness(gene, capsule) {
  const parts = { base: FITNESS_RULE.base, direction: 0, smallChange: 0, validLive: 0 };
  const schema = gene.schema;
  if (schema.type === 'number') {
    const hasRange = schema.min !== undefined && schema.max !== undefined;
    if (hasRange) {
      const mid = (schema.min + schema.max) / 2;
      const range = schema.max - schema.min || 1;
      const dFrom = Math.abs(capsule.from - mid);
      const dTo = Math.abs(capsule.to - mid);
      if (dTo < dFrom) parts.direction = FITNESS_RULE.direction.closer;
      else if (dTo > dFrom) parts.direction = FITNESS_RULE.direction.further;
      if (Math.abs(capsule.to - capsule.from) <= FITNESS_RULE.smallChange.maxRangeFraction * range) {
        parts.smallChange = FITNESS_RULE.smallChange.bonus;
      }
    }
  } else {
    parts.smallChange = FITNESS_RULE.smallChange.bonus; // non-numeric: no range notion
  }
  if (validate(schema, gene.value).ok) parts.validLive = FITNESS_RULE.validLive;
  const raw = parts.base + parts.direction + parts.smallChange + parts.validLive;
  const total = Math.round(Math.min(1, Math.max(0, raw)) * 10000) / 10000; // kill float noise, stay deterministic
  return { parts, total, threshold: THRESHOLD, promoted: total >= THRESHOLD };
}

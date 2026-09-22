/**
 * JEXI OS — Phase 28 Scope F — per-kind confidence decay.
 *
 * DECLARED SEMANTIC CONTRACT (days):
 *   event 7 · commitment 90 · preference 90 · belief 365 · fact 365
 *
 * Formula follows researched gbrain v0.31:
 *   score = confidence * exp(-ageDays / halflifeDays), clamped [0,1].
 * `nowDay` and fact.created_day are injected integer day-sequences. No clock.
 */
import { SemanticaError } from '../../semantica/_internal.js';
import { assertFactKind } from './kinds.js';

export const HALFLIFE_DAYS = Object.freeze({
  event: 7,
  commitment: 90,
  preference: 90,
  belief: 365,
  fact: 365,
});

const clamp01 = (value) => !Number.isFinite(value) || value <= 0 ? 0 : value >= 1 ? 1 : value;

export function decay(fact, { nowDay } = {}) {
  if (!fact || typeof fact !== 'object') {
    throw new SemanticaError('E_INVALID_ARGUMENT', 'decay(fact): fact must be an object');
  }
  assertFactKind(fact.kind);
  if (!Number.isInteger(fact.created_day) || !Number.isInteger(nowDay)) {
    throw new SemanticaError('E_INVALID_ARGUMENT', 'decay requires integer fact.created_day and injected nowDay');
  }
  const confidence = fact.confidence === undefined ? 1 : Number(fact.confidence);
  const ageDays = Math.max(0, nowDay - fact.created_day);
  const score = clamp01(confidence * Math.exp(-ageDays / HALFLIFE_DAYS[fact.kind]));
  return { score };
}

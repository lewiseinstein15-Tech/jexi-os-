/** JEXI OS — Phase 28 Scope K — deterministic retrieval metrics. */
import { SemanticaError } from '../../semantica/_internal.js';

function positiveK(k) {
  if (!Number.isInteger(k) || k <= 0) {
    throw new SemanticaError('E_INVALID_ARGUMENT', `k must be a positive integer, got ${JSON.stringify(k)}`);
  }
  return k;
}

function ids(input, field) {
  if (!Array.isArray(input) || input.some((id) => typeof id !== 'string' || id === '')) {
    throw new SemanticaError('E_INVALID_ARGUMENT', `${field} must be an array of non-empty document ids`);
  }
  return input;
}

function relevantSet(relevant) {
  const values = relevant instanceof Set ? [...relevant] : relevant;
  ids(values, 'relevant');
  const set = new Set(values);
  if (set.size === 0) {
    throw new SemanticaError('E_INVALID_ARGUMENT', 'relevant must contain at least one document id');
  }
  return set;
}

/** Distinct set intersection count within the first k ranking slots. */
export function hitsAtK(rankedIds, relevant, k) {
  positiveK(k);
  const ranked = ids(rankedIds, 'rankedIds').slice(0, k);
  const expected = relevantSet(relevant);
  const hits = new Set();
  for (const id of ranked) if (expected.has(id)) hits.add(id);
  return hits.size;
}

/** p@k = |relevant ∩ topK| / k, even when fewer than k docs are returned. */
export function precisionAtK(rankedIds, relevant, k) {
  return hitsAtK(rankedIds, relevant, k) / positiveK(k);
}

/** r@k = |relevant ∩ topK| / |relevant|. */
export function recallAtK(rankedIds, relevant, k) {
  const expected = relevantSet(relevant);
  return hitsAtK(rankedIds, expected, k) / expected.size;
}

export function metricsAtK(rankedIds, relevant, k) {
  const expected = relevantSet(relevant);
  const hits = hitsAtK(rankedIds, expected, k);
  return {
    k: positiveK(k),
    hits,
    relevant: expected.size,
    precision: hits / k,
    recall: hits / expected.size,
  };
}

export const precision = precisionAtK;
export const recall = recallAtK;

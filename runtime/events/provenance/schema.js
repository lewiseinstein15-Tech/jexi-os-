/**
 * JEXI OS — Phase 9 Scope G — Provenance schema.
 *
 * This file is the LAW for provenance metadata; label.js is the engine
 * that enforces it. Every OSINT data point JEXI produces or displays
 * carries one of exactly four labels so the user always knows what kind
 * of data it is. No silent inference. No "looks real so it must be real."
 *
 * The vocabulary here is the one Scope A already anticipated:
 * intelligence/trust-pipeline/registered-urls.js:11-15 and every
 * registration's `provenance` field.
 */

/** Schema version, carried in tooling that summarizes provenance. */
export const PROVENANCE_VERSION = 1;

/** The field name a labeled data point carries its provenance under. */
export const PROVENANCE_KEY = 'provenance';

/**
 * The complete label vocabulary. Exactly four. Nothing else is valid.
 *
 *   observed        — real measurement / direct fetch from a registered
 *                     source (the sensor said so, or the source API said so)
 *   estimated       — interpolated, inferred, or derived from observed data
 *                     (midpoints, gap fills, model outputs over real inputs)
 *   simulated       — mock / demonstration / test data. NEVER a real
 *                     measurement. Must never pass as observed.
 *   reconstructed   — best-effort from partial or stale data (GEV's
 *                     "RECONSTRUCTED ESTIMATE")
 */
export const LABELS = Object.freeze([
  'observed',
  'estimated',
  'simulated',
  'reconstructed',
]);

/** Labels that REQUIRE an explicit confidence value on attach. */
export const CONFIDENCE_REQUIRED = Object.freeze(
  new Set(['estimated', 'reconstructed']),
);

/** Labels for which confidence is optional (may still be provided). */
export const CONFIDENCE_OPTIONAL = Object.freeze(
  new Set(['observed', 'simulated']),
);

/**
 * Human-readable semantics — documentation that cannot rot, consumed by
 * governance surfaces that need to explain labels to users.
 */
export const LABEL_SEMANTICS = Object.freeze({
  observed: Object.freeze({
    description: 'Real measurement or direct fetch from a registered source.',
    mixing: 'Never mix with simulated in one result set without an explicit flag.',
  }),
  estimated: Object.freeze({
    description: 'Interpolated, inferred, or derived from observed data.',
    mixing: 'Confidence is required on attach.',
  }),
  simulated: Object.freeze({
    description: 'Mock, demonstration, or test data. Not a real measurement.',
    mixing: 'Never mix with observed in one result set without an explicit flag.',
  }),
  reconstructed: Object.freeze({
    description: 'Best-effort rebuild from partial or stale data (RECONSTRUCTED ESTIMATE).',
    mixing: 'Confidence is required on attach.',
  }),
});

/**
 * Set-level flag applied by label.finalizeSet when 'simulated' and
 * 'observed' co-exist in one result set. The flag IS the explicit
 * marking the rules require — the set is never returned as if uniform.
 */
export const MIXED_SIMULATED_OBSERVED_FLAG = 'SIMULATED_MIXED_WITH_OBSERVED';

const KNOWN_KEYS = Object.freeze([
  'label',
  'source',
  'method',
  'confidence',
  'timestamp',
  'notes',
]);

const ISO_LIKE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?$/;

/** True iff v is one of the four labels. */
export function isValidLabel(v) {
  return typeof v === 'string' && LABELS.includes(v);
}

/**
 * Validate a provenance object against this schema.
 * Strict: unknown keys are rejected (nothing smuggles into provenance).
 *
 * @returns {{ ok: true } | { ok: false, errors: Array<{code: string, message: string}> }}
 */
export function validateProvenance(prov) {
  const errors = [];
  if (prov === null || typeof prov !== 'object' || Array.isArray(prov)) {
    return { ok: false, errors: [{ code: 'E_INVALID_PROVENANCE', message: 'provenance must be a plain object' }] };
  }
  const keys = Object.keys(prov);
  for (const k of keys) {
    if (!KNOWN_KEYS.includes(k)) {
      errors.push({ code: 'E_INVALID_PROVENANCE', message: `unknown provenance key '${k}'` });
    }
  }
  if (!isValidLabel(prov.label)) {
    errors.push({ code: 'E_INVALID_LABEL', message: `label must be one of ${LABELS.join(' | ')}` });
  }
  if (typeof prov.source !== 'string' || prov.source.trim() === '') {
    errors.push({ code: 'E_INVALID_SOURCE', message: 'source must be a non-empty string' });
  }
  if (typeof prov.method !== 'string' || prov.method.trim() === '') {
    errors.push({ code: 'E_INVALID_METHOD', message: 'method must be a non-empty string' });
  }
  const required = isValidLabel(prov.label) && CONFIDENCE_REQUIRED.has(prov.label);
  if (prov.confidence === undefined) {
    if (required) {
      errors.push({ code: 'E_CONFIDENCE_REQUIRED', message: `confidence is required for label '${prov.label}'` });
    }
  } else if (
    typeof prov.confidence !== 'number' ||
    !Number.isFinite(prov.confidence) ||
    prov.confidence < 0 ||
    prov.confidence > 1
  ) {
    errors.push({ code: 'E_INVALID_CONFIDENCE', message: 'confidence must be a finite number in [0.0, 1.0]' });
  }
  if (typeof prov.timestamp !== 'string' || !ISO_LIKE.test(prov.timestamp) || Number.isNaN(Date.parse(prov.timestamp))) {
    errors.push({ code: 'E_INVALID_TIMESTAMP', message: 'timestamp must be an ISO-8601 string' });
  }
  if (prov.notes !== undefined && (typeof prov.notes !== 'string' || prov.notes.trim() === '')) {
    errors.push({ code: 'E_INVALID_NOTES', message: 'notes must be a non-empty string when present' });
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/**
 * JEXI OS — Phase 9 Scope G — Provenance label engine.
 *
 * Zone: events/provenance/** (Phase 9 Scope G). Vocabulary law: schema.js.
 *
 * CORE RULES ENFORCED HERE
 *   1. No data point leaves the system without a label (assertAll is the
 *      egress gate; finalizeSet is the result-set egress gate).
 *   2. 'simulated' is NEVER mixed with 'observed' in the same result set
 *      without an explicit flag (finalizeSet sets MIXED_SIMULATED_OBSERVED_FLAG).
 *   3. Confidence is required for 'estimated' and 'reconstructed',
 *      optional for 'observed' and 'simulated' (E_CONFIDENCE_REQUIRED).
 *   4. Labels travel with the data through every transformation:
 *      identity-preserving transforms use travel() and retain the label
 *      FROM THE SOURCE byte-for-byte; anything that DERIVES new values
 *      from observed inputs must instead attach 'estimated' (or
 *      'reconstructed') — never silently keep 'observed'.
 *
 * INTEGRITY
 *   - provenance objects are frozen (no silent label upgrades after attach)
 *   - keys are built in a fixed order (label, source, method, confidence?,
 *     timestamp, notes?) so same-shape provenance is byte-comparable
 *   - attach() refuses envelope-in-envelope re-wrapping (E_ALREADY_LABELED):
 *     relabeling is how 'simulated' data gets laundered into 'observed'
 *
 * INTEGRATION (P9 seam, composition — no foreign zone touched)
 *   wrapBroker(broker) wraps a Scope A trust-pipeline broker so every
 *   successful fetch result carries a provenance label taken from the
 *   registration's own declared `provenance` field. The one-line insert
 *   into broker.js itself is a zone-owner task (see README.md).
 */

import {
  CONFIDENCE_REQUIRED,
  LABELS,
  MIXED_SIMULATED_OBSERVED_FLAG,
  PROVENANCE_KEY,
  isValidLabel,
  validateProvenance,
} from './schema.js';

export { LABELS, validateProvenance, isValidLabel } from './schema.js';

export class ProvenanceError extends Error {
  /**
   * @param {string} code   stable machine-readable refusal code
   * @param {string} message human-readable reason (safe to surface)
   */
  constructor(code, message) {
    super(message);
    this.name = 'ProvenanceError';
    this.code = code;
  }
}

/* ------------------------------------------------------------------ */
/* internal: build + validate a provenance object (fixed key order)   */
/* ------------------------------------------------------------------ */

function makeProvenance({ label, source, method, confidence, notes }) {
  if (label === undefined) {
    throw new ProvenanceError('E_MISSING_LABEL', 'attach: options.label is required');
  }
  if (!isValidLabel(label)) {
    throw new ProvenanceError('E_INVALID_LABEL', `label must be one of ${LABELS.join(' | ')}; got ${JSON.stringify(label)}`);
  }
  if (typeof source !== 'string' || source.trim() === '') {
    throw new ProvenanceError('E_INVALID_SOURCE', 'attach: options.source must be a non-empty string');
  }
  if (typeof method !== 'string' || method.trim() === '') {
    throw new ProvenanceError('E_INVALID_METHOD', 'attach: options.method must be a non-empty string');
  }
  if (confidence === undefined && CONFIDENCE_REQUIRED.has(label)) {
    throw new ProvenanceError(
      'E_CONFIDENCE_REQUIRED',
      `attach: confidence is required for label '${label}' (required for estimated and reconstructed)`,
    );
  }
  if (confidence !== undefined) {
    if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      throw new ProvenanceError('E_INVALID_CONFIDENCE', 'attach: confidence must be a finite number in [0.0, 1.0]');
    }
  }
  if (notes !== undefined && (typeof notes !== 'string' || notes.trim() === '')) {
    throw new ProvenanceError('E_INVALID_NOTES', 'attach: notes must be a non-empty string when present');
  }
  // Fixed key order → deterministic shape (P10).
  const prov = { label, source, method };
  if (confidence !== undefined) prov.confidence = confidence;
  prov.timestamp = new Date().toISOString();
  if (notes !== undefined) prov.notes = notes;
  return Object.freeze(prov);
}

/** True iff x is a plain (non-array, non-null) object. */
function isPlainObject(x) {
  return x !== null && typeof x === 'object' && !Array.isArray(x);
}

/** True iff x already looks like a labeled envelope { data, provenance }. */
function looksLikeEnvelope(x) {
  if (!isPlainObject(x)) return false;
  if (!Object.prototype.hasOwnProperty.call(x, 'data')) return false;
  if (!Object.prototype.hasOwnProperty.call(x, PROVENANCE_KEY)) return false;
  return validateProvenance(x[PROVENANCE_KEY]).ok;
}

function refuseDoubleWrap() {
  throw new ProvenanceError(
    'E_ALREADY_LABELED',
    `attach: data point is already a labeled envelope — unwrap .${'data'} or use travel(); re-labeling is how provenance gets laundered`,
  );
}

/* ------------------------------------------------------------------ */
/* attach                                                              */
/* ------------------------------------------------------------------ */

/**
 * Attach a provenance label to a data point.
 *
 * @param {*} dataPoint the raw data (any JSON-ish value; not mutated)
 * @param {{ label: string, source: string, method: string,
 *           confidence?: number, notes?: string }} options
 * @returns {{ data: *, provenance: object }} frozen envelope
 * @throws ProvenanceError with a stable code on any refusal
 */
export function attach(dataPoint, options = {}) {
  if (dataPoint === undefined || dataPoint === null) {
    throw new ProvenanceError('E_INVALID_DATA_POINT', 'attach: dataPoint must not be null or undefined');
  }
  if (looksLikeEnvelope(dataPoint)) refuseDoubleWrap();
  const provenance = makeProvenance(options);
  return Object.freeze({ data: dataPoint, provenance });
}

/** Convenience: attach with the label pre-declared. */
export function attachObserved(dataPoint, opts = {}) {
  return attach(dataPoint, { ...opts, label: 'observed' });
}
export function attachEstimated(dataPoint, opts = {}) {
  return attach(dataPoint, { ...opts, label: 'estimated' });
}
export function attachSimulated(dataPoint, opts = {}) {
  return attach(dataPoint, { ...opts, label: 'simulated' });
}
export function attachReconstructed(dataPoint, opts = {}) {
  return attach(dataPoint, { ...opts, label: 'reconstructed' });
}

/* ------------------------------------------------------------------ */
/* check / of                                                          */
/* ------------------------------------------------------------------ */

/**
 * Does this data point carry a (schema-valid) provenance field?
 * A present-but-garbage provenance field does NOT pass — an invalid
 * label must never be treated as labeled.
 */
export function check(dataPoint) {
  if (!isPlainObject(dataPoint)) return false;
  if (!Object.prototype.hasOwnProperty.call(dataPoint, PROVENANCE_KEY)) return false;
  return validateProvenance(dataPoint[PROVENANCE_KEY]).ok;
}

/** The provenance of a labeled point, or null. Read-only convenience. */
export function of(dataPoint) {
  return check(dataPoint) ? dataPoint[PROVENANCE_KEY] : null;
}

/* ------------------------------------------------------------------ */
/* assertAll (egress gate)                                             */
/* ------------------------------------------------------------------ */

function preview(x) {
  let s;
  try {
    s = JSON.stringify(x);
  } catch {
    s = String(x);
  }
  if (typeof s !== 'string') s = String(s);
  return s.length > 160 ? `${s.slice(0, 157)}...` : s;
}

/**
 * Egress gate: every data point leaving the system must be labeled.
 *
 * @param {Array} dataPoints
 * @returns {number} how many points were checked
 * @throws ProvenanceError E_INVALID_SET | E_MISSING_PROVENANCE | E_INVALID_PROVENANCE
 *   — the error NAMES the offending point (index + preview)
 */
export function assertAll(dataPoints) {
  if (!Array.isArray(dataPoints)) {
    throw new ProvenanceError('E_INVALID_SET', 'assertAll: dataPoints must be an array');
  }
  dataPoints.forEach((point, i) => {
    if (!isPlainObject(point) || !Object.prototype.hasOwnProperty.call(point, PROVENANCE_KEY)) {
      throw new ProvenanceError(
        'E_MISSING_PROVENANCE',
        `assertAll: data point at index ${i} has no provenance field — preview: ${preview(point)}`,
      );
    }
    const verdict = validateProvenance(point[PROVENANCE_KEY]);
    if (!verdict.ok) {
      const first = verdict.errors[0];
      throw new ProvenanceError(
        'E_INVALID_PROVENANCE',
        `assertAll: data point at index ${i} carries invalid provenance (${first.code}: ${first.message}) — preview: ${preview(point)}`,
      );
    }
  });
  return dataPoints.length;
}

/* ------------------------------------------------------------------ */
/* travel (labels survive transformations)                             */
/* ------------------------------------------------------------------ */

/**
 * Carry a labeled point's provenance onto the output of an
 * identity-preserving transform (filter / sort / project / reshape).
 * The provenance object is copied VERBATIM — same label, same source,
 * same method, same confidence, same timestamp — because the values
 * still originate from the same source observation.
 *
 * If the transform DERIVES new values (interpolation, inference,
 * rebuild), do NOT travel — attach 'estimated' or 'reconstructed'.
 *
 * @param {{ data: *, provenance: object }} labeledPoint
 * @param {*} newData output of the transform
 * @returns {{ data: *, provenance: object }} new frozen envelope
 */
export function travel(labeledPoint, newData) {
  if (!check(labeledPoint)) {
    throw new ProvenanceError(
      'E_MISSING_PROVENANCE',
      `travel: source point has no valid provenance field — preview: ${preview(labeledPoint)}`,
    );
  }
  if (newData === undefined || newData === null) {
    throw new ProvenanceError('E_INVALID_DATA_POINT', 'travel: newData must not be null or undefined');
  }
  if (looksLikeEnvelope(newData)) refuseDoubleWrap();
  return Object.freeze({ data: newData, provenance: Object.freeze({ ...labeledPoint[PROVENANCE_KEY] }) });
}

/* ------------------------------------------------------------------ */
/* result-set level: summarize / finalizeSet                           */
/* ------------------------------------------------------------------ */

/**
 * Read-only summary of a result set. Never throws on unlabeled points —
 * they are counted, honestly, as unlabeled.
 */
export function summarize(dataPoints) {
  if (!Array.isArray(dataPoints)) {
    throw new ProvenanceError('E_INVALID_SET', 'summarize: dataPoints must be an array');
  }
  const counts = { observed: 0, estimated: 0, simulated: 0, reconstructed: 0, unlabeled: 0, invalid: 0 };
  for (const point of dataPoints) {
    if (!isPlainObject(point) || !Object.prototype.hasOwnProperty.call(point, PROVENANCE_KEY)) {
      counts.unlabeled += 1;
      continue;
    }
    const verdict = validateProvenance(point[PROVENANCE_KEY]);
    if (!verdict.ok) {
      counts.invalid += 1;
      continue;
    }
    counts[point[PROVENANCE_KEY].label] += 1;
  }
  const distinctLabels = LABELS.filter((l) => counts[l] > 0);
  return Object.freeze({
    total: dataPoints.length,
    counts: Object.freeze(counts),
    distinctLabels: Object.freeze(distinctLabels),
    mixed: distinctLabels.length > 1,
    conflict: counts.observed > 0 && counts.simulated > 0,
  });
}

/**
 * Result-set egress gate: assert every point is labeled, then return the
 * set wrapped in an envelope that EXPLICITLY flags a simulated/observed
 * mix instead of silently returning it as if uniform.
 *
 * @param {Array} dataPoints labeled envelopes
 * @returns {{ results: Array, provenanceSummary: object, mixed: boolean,
 *             conflict?: boolean, flag?: string, flagDetail?: string }}
 */
export function finalizeSet(dataPoints) {
  assertAll(dataPoints);
  const summary = summarize(dataPoints);
  const envelope = {
    results: dataPoints,
    provenanceSummary: summary,
    mixed: summary.mixed,
  };
  if (summary.conflict) {
    envelope.conflict = true;
    envelope.flag = MIXED_SIMULATED_OBSERVED_FLAG;
    envelope.flagDetail =
      `result set mixes ${summary.counts.simulated} simulated point(s) with ` +
      `${summary.counts.observed} observed point(s) — simulated data must never pass as observed`;
  }
  return Object.freeze(envelope);
}

/* ------------------------------------------------------------------ */
/* P9 integration: wrap a Scope A trust-pipeline broker                */
/* ------------------------------------------------------------------ */

/**
 * Composition seam for intelligence/trust-pipeline/broker.js.
 *
 * Every SUCCESSFUL broker fetch result gains a `provenance` field whose
 * label comes from the URL registration's own declared `provenance`
 * (registered-urls.js — Scope A already declared 'observed' per source).
 * Refused/failed fetches produce NO data, so they carry NO label.
 *
 * The permanent one-line insert at broker.js:177-190 (the ok:true return)
 * is a zone-owner task; this wrapper is the drop-in proof that the seam
 * works without touching the foreign zone.
 *
 * @param {{ fetch: Function, status: Function }} broker result of createBroker()
 * @param {{ method?: string }} [opts]
 */
export function wrapBroker(broker, { method = 'trust-pipeline broker fetch' } = {}) {
  if (!broker || typeof broker.fetch !== 'function') {
    throw new ProvenanceError('E_INVALID_ARG', 'wrapBroker: broker must expose fetch()');
  }
  return {
    async fetch(rawUrl, opts = {}) {
      const result = await broker.fetch(rawUrl, opts);
      if (result && result.ok) {
        const reg = result.registration || {};
        if (reg.provenance !== undefined && !isValidLabel(reg.provenance)) {
          throw new ProvenanceError(
            'E_INVALID_LABEL',
            `wrapBroker: registration '${reg.id || reg.host}' declares invalid provenance ${JSON.stringify(reg.provenance)}`,
          );
        }
        const label = reg.provenance || 'observed';
        const source = reg.provider || reg.host || 'unknown-source';
        result.provenance = makeProvenance({
          label,
          source,
          method,
          notes: reg.id ? `registration ${reg.id} (layer: ${reg.layer || 'none'})` : undefined,
        });
      }
      return result;
    },
    status() {
      return broker.status();
    },
  };
}

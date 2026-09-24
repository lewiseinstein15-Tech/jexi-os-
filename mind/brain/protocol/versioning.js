/**
 * JEXI OS — Phase 28 Scope H — additive-forever v1 policy.
 * Existing signatures and top-level envelope keys never change. Optional
 * capability fields may only be added inside `data`; new verbs require v2.
 */
import { PROTOCOL_VERSION, SURFACES, VERB_NAMES } from './verbs.js';
import { failureEnvelope, inspectEnvelope, successEnvelope } from './envelope.js';
import { errorContract } from './errors.js';

export const VERSIONING_POLICY = Object.freeze({
  mode: 'additive-forever',
  immutableVerbSignatures: true,
  immutableEnvelopeKeys: true,
  optionalAdditionsLocation: 'data',
  newVerbsRequire: 'v2',
});

export function versionInfo() {
  return Object.freeze({
    protocolVersion: PROTOCOL_VERSION,
    surfaces: Object.freeze([...SURFACES]),
  });
}

/** Reject a candidate with a protocol-shaped error instead of leaking drift. */
export function enforceEnvelope(candidate) {
  const violation = inspectEnvelope(candidate);
  if (!violation) {
    return candidate.ok
      ? successEnvelope(candidate.verb, candidate.data)
      : failureEnvelope(candidate.verb, candidate.error);
  }
  return failureEnvelope(candidate?.verb, errorContract(
    'E_ENVELOPE_SHAPE_VIOLATION',
    `envelope.${violation.field}: ${violation.message}`,
    false,
  ));
}

/** Sanctioned additive extension: optional keys are merged inside data only. */
export function extendData(envelope, additions) {
  const violation = inspectEnvelope(envelope);
  if (violation || envelope.ok !== true || !additions || typeof additions !== 'object' || Array.isArray(additions)) {
    return failureEnvelope(envelope?.verb, errorContract(
      'E_ENVELOPE_SHAPE_VIOLATION',
      `data extension refused${violation ? ` at envelope.${violation.field}` : ''}`,
      false,
    ));
  }
  return successEnvelope(envelope.verb, { ...envelope.data, ...additions });
}

export function frozenVerbNames() {
  return [...VERB_NAMES];
}

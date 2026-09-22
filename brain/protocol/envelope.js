/**
 * JEXI OS — Phase 28 Scope H — exact frozen response envelope.
 *
 * Success: { verb, version: "1.0", ok: true,  data: object }
 * Failure: { verb, version: "1.0", ok: false, error: {code,message,retryable} }
 * No other top-level keys are legal in v1.
 */
import { PROTOCOL_VERSION } from './verbs.js';
import { ERROR_CODES, errorContract } from './errors.js';

export const BASE_ENVELOPE_KEYS = Object.freeze(['verb', 'version', 'ok']);
export const SUCCESS_ENVELOPE_KEYS = Object.freeze(['verb', 'version', 'ok', 'data']);
export const ERROR_ENVELOPE_KEYS = Object.freeze(['verb', 'version', 'ok', 'error']);
export const ERROR_KEYS = Object.freeze(['code', 'message', 'retryable']);

const plainObject = (value) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function safeVerb(verb) {
  return typeof verb === 'string' && verb !== '' ? verb : 'unknown';
}

export function successEnvelope(verb, data = {}) {
  if (!plainObject(data)) throw new TypeError('protocol success data must be an object');
  return deepFreeze({
    verb: safeVerb(verb),
    version: PROTOCOL_VERSION,
    ok: true,
    data: clone(data),
  });
}

export function failureEnvelope(verb, error) {
  const normalized = plainObject(error)
    ? errorContract(error.code, error.message, error.retryable)
    : errorContract('E_INTERNAL', 'protocol operation failed', false);
  return deepFreeze({
    verb: safeVerb(verb),
    version: PROTOCOL_VERSION,
    ok: false,
    error: { ...normalized },
  });
}

const compareText = (a, b) => String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;

/** Returns null when valid; otherwise the first deterministic field violation. */
export function inspectEnvelope(envelope) {
  if (!plainObject(envelope)) return { field: '$', message: 'envelope must be an object' };
  const allowed = envelope.ok === true ? SUCCESS_ENVELOPE_KEYS :
    envelope.ok === false ? ERROR_ENVELOPE_KEYS : [...BASE_ENVELOPE_KEYS, 'data', 'error'];
  const unknown = Object.keys(envelope).filter((key) => !allowed.includes(key)).sort(compareText)[0];
  if (unknown) return { field: unknown, message: `unknown top-level key ${JSON.stringify(unknown)}; additions belong inside data` };
  if (typeof envelope.verb !== 'string' || envelope.verb === '') return { field: 'verb', message: 'must be a non-empty string' };
  if (envelope.version !== PROTOCOL_VERSION) return { field: 'version', message: `must equal ${JSON.stringify(PROTOCOL_VERSION)}` };
  if (typeof envelope.ok !== 'boolean') return { field: 'ok', message: 'must be a boolean' };
  if (envelope.ok) {
    if (!Object.prototype.hasOwnProperty.call(envelope, 'data')) return { field: 'data', message: 'success envelope requires data' };
    if (!plainObject(envelope.data)) return { field: 'data', message: 'must be an object' };
    if (Object.prototype.hasOwnProperty.call(envelope, 'error')) return { field: 'error', message: 'must be absent when ok is true' };
    return null;
  }
  if (!Object.prototype.hasOwnProperty.call(envelope, 'error')) return { field: 'error', message: 'failure envelope requires error' };
  if (!plainObject(envelope.error)) return { field: 'error', message: 'must be an object' };
  if (Object.prototype.hasOwnProperty.call(envelope, 'data')) return { field: 'data', message: 'must be absent when ok is false' };
  const unknownError = Object.keys(envelope.error).filter((key) => !ERROR_KEYS.includes(key)).sort(compareText)[0];
  if (unknownError) return { field: `error.${unknownError}`, message: 'unknown error-contract key' };
  for (const key of ERROR_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(envelope.error, key)) return { field: `error.${key}`, message: 'required field is missing' };
  }
  if (typeof envelope.error.code !== 'string' || envelope.error.code === '') return { field: 'error.code', message: 'must be a non-empty string' };
  if (!ERROR_CODES.includes(envelope.error.code)) return { field: 'error.code', message: `unknown frozen error code ${JSON.stringify(envelope.error.code)}` };
  if (typeof envelope.error.message !== 'string' || envelope.error.message === '') return { field: 'error.message', message: 'must be a non-empty string' };
  if (typeof envelope.error.retryable !== 'boolean') return { field: 'error.retryable', message: 'must be a boolean' };
  return null;
}

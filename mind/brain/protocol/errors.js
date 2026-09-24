/**
 * JEXI OS — Phase 28 Scope H — frozen protocol error contract.
 * Reuses SemanticaError; this scope introduces no error class.
 */
import { SemanticaError } from '../../../services/semantica/_internal.js';

export const ERROR_CODES = Object.freeze([
  'E_INVALID_ARGUMENT',
  'E_UNKNOWN_VERB',
  'E_UNKNOWN_ENTITY',
  'E_NOT_FOUND',
  'E_DELEGATE_UNAVAILABLE',
  'E_ENVELOPE_SHAPE_VIOLATION',
  'E_CONFORMANCE_FAIL',
  'E_INTERNAL',
]);

const ERROR_SET = new Set(ERROR_CODES);
const RETRYABLE = new Set(['E_DELEGATE_UNAVAILABLE']);

export function errorContract(code, message, retryable = RETRYABLE.has(code)) {
  const stableCode = ERROR_SET.has(code) ? code : 'E_INTERNAL';
  return Object.freeze({
    code: stableCode,
    message: typeof message === 'string' && message !== '' ? message : stableCode,
    retryable: retryable === true,
  });
}

export function normalizeError(error) {
  const sourceCode = typeof error?.code === 'string' ? error.code : 'E_INTERNAL';
  const message = typeof error?.message === 'string' && error.message !== ''
    ? error.message : 'protocol operation failed';
  if (ERROR_SET.has(sourceCode)) return errorContract(sourceCode, message);
  if (['E_INVALID_QUERY', 'E_INVALID_PROPS', 'E_UNKNOWN_KIND', 'E_UNKNOWN_BACKEND', 'E_BACKEND_CONTRACT'].includes(sourceCode)) {
    return errorContract('E_INVALID_ARGUMENT', message, false);
  }
  if (sourceCode === 'E_UNKNOWN_PAGE') return errorContract('E_NOT_FOUND', message, false);
  if (sourceCode === 'E_PROVIDER_UNAVAILABLE') return errorContract('E_DELEGATE_UNAVAILABLE', message, true);
  return errorContract('E_INTERNAL', message, false);
}

export function protocolFailure(code, message) {
  return new SemanticaError(code, message);
}

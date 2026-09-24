/**
 * JEXI OS — Phase 14 — Semantica shared internals.
 *
 * Typed errors for the semantic reasoning layer. Every thrown error
 * carries a stable `code` so probes and callers can assert on the
 * contract, not on message text.
 */

export class SemanticaError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SemanticaError';
    this.code = code;
  }
}

export function fail(code, message) {
  return new SemanticaError(code, message);
}

/** Strict plain-object check used by every props bag. */
export function assertProps(props, what) {
  if (props === undefined || props === null) return {};
  if (typeof props !== 'object' || Array.isArray(props)) {
    throw fail('E_INVALID_PROPS', `${what} props must be a plain object, got ${Array.isArray(props) ? 'array' : typeof props}`);
  }
  return props;
}

export function assertNonEmptyString(value, what, code = 'E_INVALID_ARGUMENT') {
  if (typeof value !== 'string' || value.trim() === '') {
    throw fail(code, `${what} must be a non-empty string, got ${JSON.stringify(value)}`);
  }
  return value;
}

export const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

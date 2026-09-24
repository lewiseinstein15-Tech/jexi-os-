// computer/remote/operator.js
// Phase 29 Scope J — the remote operator (REST + VNC preview).
//
// TARS runAgent.ts selects a remote operator when settings.operator is a
// remote mode: the VM/browser is driven over a REST API while a VNC preview
// shows it. JEXI ports the CONTRACT, not the transport: the REST client is
// an INJECTED SEAM (configure in index.js) and the operator object that
// wraps it satisfies the Scope B Operator contract EXACTLY — same
// capabilities shape, same execute()/screenshot() shapes, same error
// layering as computer/operators/desktop.js:
//
//   operator.name          -> 'remote'
//   operator.capabilities  -> { screenshot, mouse, keyboard, mobile, desktop }
//   operator.screenshot()  -> { image, width, height, dpi }  (raw; remote
//                             error -> THROWS ComputerError, like desktop's
//                             E_NO_DISPLAY path)
//   operator.execute(a)    -> { ok: true, result } |
//                             { ok: false, error: { code, message } }
//                             (remote error RETURNED as an envelope with
//                             code E_REMOTE_ERROR — like desktop's returned
//                             E_NO_DISPLAY envelope; malformed input THROWS)
//   operator.assert()      -> assertOperator (Scope B validator)
//
// Declared REST client surface (synchronous; async transports resolve
// BEHIND the seam before injection):
//   client.connect({ endpoint, credentials })  -> { sessionId } |
//                                                 { error: { code, message } }
//   client.screenshot({ sessionId })           -> { image, width, height, dpi } |
//                                                 { error: { code, message } }
//   client.execute({ sessionId, action })      -> { ok: true, result } |
//                                                 { ok: false, error: { code, message } }
//
// CREDENTIALS — keyRef discipline (Phase 27, providers/profiles/schema.js,
// consumed READ-ONLY; the three patterns are redeclared here VERBATIM so
// computer/** stays self-contained — disclosed duplication):
//   keyRef  := env-var name (^[A-Z_][A-Z0-9_]*$) | keyring:<name>[/path]
//   A credentials entry whose field matches INLINE_KEY_FIELD_RE, or whose
//   value is not a keyRef, is an inline credential -> E_INLINE_KEY_REFUSED.
//   The facade never resolves refs — they pass through to the client seam.
//
// Error codes declared by Scope J (ComputerError only — no new class):
//   E_REMOTE_UNAVAILABLE  no client configured / no session
//   E_INLINE_KEY_REFUSED  inline credential detected in connect config
//   E_REMOTE_ERROR        the remote returned an error envelope
//   E_INVALID_ARGUMENT    reused from Scope A — bad input / malformed client
//                         response (never guessed around, never faked)
//
// Deterministic for a given injected client: no clock, no randomness, no
// host I/O in this module.

import { ComputerError } from '../errors.js';
import { assertOperator } from '../operators/interface.js';
import { buildVncPreviewUrl } from './vnc.js';

export const REMOTE_CODES = Object.freeze([
  'E_REMOTE_UNAVAILABLE',
  'E_INLINE_KEY_REFUSED',
  'E_REMOTE_ERROR',
]);

// --- Phase 27 keyRef discipline (verbatim redeclaration, read-only authority:
// --- providers/profiles/schema.js) -------------------------------------------

export const ENV_REF_RE = /^[A-Z_][A-Z0-9_]*$/;
// keyring refs carry service/account path segments: keyring:<seg>[/<seg>...]
export const KEYRING_REF_RE = /^keyring:[A-Za-z0-9][A-Za-z0-9._/:-]*$/;
/** Field names that must never carry a credential value (Phase 27 rule). */
export const INLINE_KEY_FIELD_RE = /^(api[-_]?key|key|secret|token|password|access[-_]?token|private[-_]?key)$/i;

/**
 * Validate connect credentials against the keyRef discipline.
 *   - absent -> { ok: true, refs: {} }
 *   - every entry value must be a keyRef (env name or keyring:<...>) — an
 *     entry with a non-keyRef string value, or a credential-named field,
 *     is an INLINE credential -> E_INLINE_KEY_REFUSED
 *   - non-object / non-string entries -> E_INVALID_ARGUMENT
 * Returns { ok, refs } — refs pass through UNRESOLVED (no secret ever
 * exists in this module).
 */
export function validateCredentials(credentials) {
  if (credentials === undefined) return { ok: true, refs: {} };
  if (credentials === null || typeof credentials !== 'object' || Array.isArray(credentials)) {
    throw new ComputerError(
      'E_INVALID_ARGUMENT',
      `remote: credentials must be an object of keyRef entries (got ${credentials === null ? 'null' : typeof credentials})`,
      { got: credentials === null ? 'null' : typeof credentials }
    );
  }
  const refs = {};
  for (const [field, value] of Object.entries(credentials)) {
    if (INLINE_KEY_FIELD_RE.test(field) && typeof value === 'string' && value.length > 0) {
      throw new ComputerError(
        'E_INLINE_KEY_REFUSED',
        `remote: credential field "${field}" looks like an inline credential; connect config carries keyRef references only (Phase 27 discipline)`,
        { field }
      );
    }
    if (typeof value !== 'string' || value.length === 0) {
      throw new ComputerError(
        'E_INVALID_ARGUMENT',
        `remote: credential "${field}" must be a non-empty keyRef string (got ${value === null ? 'null' : typeof value})`,
        { field, got: value === null ? 'null' : typeof value }
      );
    }
    if (!ENV_REF_RE.test(value) && !KEYRING_REF_RE.test(value)) {
      throw new ComputerError(
        'E_INLINE_KEY_REFUSED',
        `remote: credential "${field}" is not a keyRef (env var name or keyring:<name>) — inline credential literals are refused`,
        { field, got: value }
      );
    }
    refs[field] = value;
  }
  return { ok: true, refs };
}

/** The declared REST client surface, frozen. */
export const REMOTE_CLIENT_METHODS = Object.freeze([
  Object.freeze({ method: 'connect', result: '{ sessionId } | { error: { code, message } }' }),
  Object.freeze({ method: 'screenshot', result: '{ image, width, height, dpi } | { error: { code, message } }' }),
  Object.freeze({ method: 'execute', result: '{ ok: true, result } | { ok: false, error: { code, message } }' }),
]);

/** Structural check: does this object satisfy the REST client contract? */
export function assertRemoteClient(client) {
  const fail = (field) => {
    throw new ComputerError(
      'E_INVALID_ARGUMENT',
      `remote: client does not satisfy the REST contract: ${field}`,
      { field, got: client && typeof client === 'object' ? Object.keys(client) : typeof client }
    );
  };
  if (!client || typeof client !== 'object' || Array.isArray(client)) fail('not an object');
  const missing = REMOTE_CLIENT_METHODS.filter((m) => typeof client[m.method] !== 'function');
  if (missing.length > 0) {
    throw new ComputerError(
      'E_INVALID_ARGUMENT',
      `remote: client must implement ${REMOTE_CLIENT_METHODS.map((m) => m.method).join('/')} (missing: ${missing.map((m) => m.method).join(', ')})`,
      { missing: missing.map((m) => m.method) }
    );
  }
  return true;
}

/**
 * Read one remote error envelope. Anything without non-empty string
 * code+message is a malformed client response (E_INVALID_ARGUMENT) —
 * never normalized into a fake reason.
 */
export function readRemoteError(envelope, what) {
  const bad = () =>
    new ComputerError(
      'E_INVALID_ARGUMENT',
      `remote: ${what} client returned a malformed error envelope — expected { code, message }`,
      { got: envelope === null ? 'null' : typeof envelope }
    );
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) throw bad();
  if (typeof envelope.code !== 'string' || envelope.code.length === 0) throw bad();
  if (typeof envelope.message !== 'string' || envelope.message.length === 0) throw bad();
  return { code: envelope.code, message: envelope.message };
}

/** Map a remote error envelope to a thrown ComputerError(E_REMOTE_ERROR). */
export function toRemoteError(what, envelope, sessionId) {
  const err = readRemoteError(envelope, what);
  return new ComputerError('E_REMOTE_ERROR', `remote ${what} failed: ${err.message}`, {
    code: err.code,
    reason: err.message,
    sessionId: sessionId === undefined ? null : sessionId,
  });
}

/**
 * Build the Scope B operator VIEW over an established remote session.
 * Requires client + endpoint + sessionId (connect already validated them).
 */
export function createRemoteOperator({ client, endpoint, sessionId }) {
  if (!client || typeof client !== 'object') {
    throw new ComputerError('E_INVALID_ARGUMENT', 'remote: operator requires an injected client', {
      got: typeof client,
    });
  }
  if (typeof endpoint !== 'string' || endpoint.length === 0) {
    throw new ComputerError('E_INVALID_ARGUMENT', 'remote: operator requires a non-empty endpoint', {});
  }
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    throw new ComputerError('E_INVALID_ARGUMENT', 'remote: operator requires a non-empty sessionId', {});
  }

  const op = {
    name: 'remote',
    capabilities: Object.freeze({
      screenshot: true,
      mouse: true,
      keyboard: true,
      mobile: false,
      desktop: true,
    }),

    /** Session introspection: { sessionId, endpoint }. */
    session() {
      return { sessionId, endpoint };
    },

    /** Pure VNC preview for this session (or an explicit session id). */
    vncPreview(who) {
      return buildVncPreviewUrl({ endpoint, sessionId: who === undefined ? sessionId : who });
    },

    screenshot() {
      const res = client.screenshot({ sessionId });
      if (res !== null && typeof res === 'object' && !Array.isArray(res) && res.error !== undefined) {
        throw toRemoteError('screenshot', res.error, sessionId);
      }
      if (
        res === null || typeof res !== 'object' || Array.isArray(res) ||
        typeof res.image !== 'string' ||
        !Number.isInteger(res.width) || !Number.isInteger(res.height) ||
        typeof res.dpi !== 'number'
      ) {
        throw new ComputerError(
          'E_INVALID_ARGUMENT',
          'remote: screenshot client returned a malformed result — expected { image: string, width: int, height: int, dpi: number }',
          { got: res === null ? 'null' : typeof res }
        );
      }
      return { image: res.image, width: res.width, height: res.height, dpi: res.dpi };
    },

    execute(action) {
      if (!action || typeof action !== 'object' || typeof action.action !== 'string') {
        throw new ComputerError('E_INVALID_ARGUMENT', 'execute expects a parsed action { action, args }', {
          got: action === null ? 'null' : typeof action,
        });
      }
      const res = client.execute({ sessionId, action });
      if (res !== null && typeof res === 'object' && !Array.isArray(res)) {
        if (res.ok === true) return { ok: true, result: res.result };
        if (res.ok === false && res.error !== undefined) {
          const err = readRemoteError(res.error, 'execute');
          // Scope B envelope discipline: remote failures are RETURNED here
          // (the loop records one failed step), coded E_REMOTE_ERROR with
          // the remote's own code + reason carried in the message.
          return { ok: false, error: { code: 'E_REMOTE_ERROR', message: `${err.code}: ${err.message}` } };
        }
      }
      throw new ComputerError(
        'E_INVALID_ARGUMENT',
        'remote: execute client returned a malformed result — expected { ok: true, result } | { ok: false, error: { code, message } }',
        { got: res === null ? 'null' : typeof res }
      );
    },

    assert() {
      return assertOperator(op);
    },
  };
  return op;
}

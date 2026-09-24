// computer/remote/index.js
// Phase 29 Scope J — public surface of remote operator support.
//
//   remote.connect({ endpoint, credentials }) -> { sessionId }
//   remote.screenshot()                       -> { image, width, height, dpi }
//   remote.execute(action)                    -> { ok, result } | { ok, error }
//   remote.vncPreview(sessionId?)             -> { url }
//   remote.configure({ client })              -> { ok: true }      (SEAM)
//   remote.detach()                           -> { detached: true }
//   remote.session()                          -> { sessionId, endpoint } | nulls
//   remote.name / remote.capabilities / remote.assert()
//         — the facade ITSELF satisfies the Scope B Operator contract
//           (assertOperator passes), same shapes as the desktop operator.
//
// LIFECYCLE (TARS runAgent.ts operator selection): the host INJECTS a REST
// client via configure(); connect() establishes a session on that client and
// attaches the Scope B operator view (operator.js). Unconfigured or
// unconnected, every operation refuses with E_REMOTE_UNAVAILABLE — thrown,
// never faked (mirrors the Scope I sandbox discipline; the Scope B returned
// envelope applies to RUNTIME remote errors once connected).
//
// The REST client is a SEAM — injected, never constructed here, never faked.
// connect() enforces the Phase 27 keyRef discipline: inline credentials in
// the config (credential-named fields, non-keyRef values, or userinfo
// embedded in the endpoint) are refused with E_INLINE_KEY_REFUSED. Refs are
// passed through UNRESOLVED — no secret ever exists in this module.
// remote errors reported by the client surface as E_REMOTE_ERROR with the
// remote's own code + reason carried (thrown from connect/screenshot,
// returned as the Scope B envelope from execute).
//
// Deterministic for a given injected client: closure state, frozen surface,
// no clock, no randomness, no host I/O anywhere in this module.
//
// Re-exports: REMOTE_CODES / REMOTE_CONTRACT / REMOTE_CLIENT_METHODS /
// assertRemoteClient / validateCredentials / createRemoteOperator /
// buildVncPreviewUrl. All errors are ComputerError — zero new classes, zero
// new dependencies.

import { ComputerError } from '../errors.js';
import { assertOperator, OPERATOR_CAPABILITY_KEYS } from '../operators/interface.js';
import {
  REMOTE_CODES,
  REMOTE_CLIENT_METHODS,
  assertRemoteClient,
  validateCredentials,
  toRemoteError,
  createRemoteOperator,
} from './operator.js';
import { buildVncPreviewUrl } from './vnc.js';

/** The declared Scope J contract methods. */
export const REMOTE_CONTRACT = Object.freeze(['connect', 'screenshot', 'execute', 'vncPreview']);

// Closure state — mutated only by configure/connect/detach.
const state = {
  client: null,
  operator: null,
  endpoint: null,
  sessionId: null,
};

/** Session gate: every operation needs an attached client AND a session. */
function requireSession() {
  if (state.client === null || state.operator === null) {
    throw new ComputerError(
      'E_REMOTE_UNAVAILABLE',
      'remote: no session — configure a REST client and connect first',
      { configured: state.client !== null, connected: state.operator !== null }
    );
  }
}

/** Validate an endpoint: absolute http(s) URL, no userinfo credentials. */
function assertEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || endpoint.length === 0) {
    throw new ComputerError(
      'E_INVALID_ARGUMENT',
      `remote: connect requires a non-empty string endpoint (got ${endpoint === null ? 'null' : typeof endpoint})`,
      { got: endpoint === null ? 'null' : typeof endpoint }
    );
  }
  let parsed;
  try {
    parsed = new URL(endpoint);
  } catch (e) {
    throw new ComputerError('E_INVALID_ARGUMENT', `remote: endpoint must be an absolute http(s) URL (got '${endpoint}')`, {
      endpoint,
    });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ComputerError(
      'E_INVALID_ARGUMENT',
      `remote: endpoint protocol must be http(s) (got '${parsed.protocol}')`,
      { protocol: parsed.protocol }
    );
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw new ComputerError(
      'E_INLINE_KEY_REFUSED',
      'remote: endpoint embeds credentials (userinfo) — pass credentials via keyRef (Phase 27 discipline)',
      { host: parsed.host }
    );
  }
  return endpoint;
}

export const remote = Object.freeze({
  /** Scope B Operator contract fields — the facade IS an operator view. */
  name: 'remote',
  capabilities: Object.freeze({
    screenshot: true,
    mouse: true,
    keyboard: true,
    mobile: false,
    desktop: true,
  }),

  /**
   * Attach the REST client SEAM. Shape-validated before acceptance; no
   * health gate is declared for the remote seam (the session itself is the
   * liveness proof — connect() fails loudly otherwise).
   */
  configure({ client } = {}) {
    if (client === null || typeof client !== 'object' || Array.isArray(client)) {
      throw new ComputerError(
        'E_INVALID_ARGUMENT',
        `remote: configure requires a client object (got ${client === null ? 'null' : typeof client})`,
        { got: client === null ? 'null' : typeof client }
      );
    }
    assertRemoteClient(client);
    state.client = client;
    return { ok: true };
  },

  /** Detach the client and drop the session (probe/di hygiene). */
  detach() {
    state.client = null;
    state.operator = null;
    state.endpoint = null;
    state.sessionId = null;
    return { detached: true };
  },

  /**
   * Establish a session. Order (declared, nothing mutates until all pass):
   *   1. client attached                 -> E_REMOTE_UNAVAILABLE
   *   2. endpoint shape                  -> E_INVALID_ARGUMENT
   *   3. endpoint userinfo               -> E_INLINE_KEY_REFUSED
   *   4. credentials keyRef discipline   -> E_INLINE_KEY_REFUSED / E_INVALID_ARGUMENT
   *   5. client.connect                  -> E_REMOTE_ERROR (error envelope)
   *                                       / E_INVALID_ARGUMENT (malformed)
   */
  connect({ endpoint, credentials } = {}) {
    if (state.client === null) {
      throw new ComputerError(
        'E_REMOTE_UNAVAILABLE',
        'remote: no REST client configured — remote is unavailable',
        { configured: false }
      );
    }
    const checkedEndpoint = assertEndpoint(endpoint);
    const cred = validateCredentials(credentials);
    const res = state.client.connect({ endpoint: checkedEndpoint, credentials: cred.refs });
    if (res !== null && typeof res === 'object' && !Array.isArray(res) && res.error !== undefined) {
      throw toRemoteError('connect', res.error, null);
    }
    if (res === null || typeof res !== 'object' || Array.isArray(res) ||
        typeof res.sessionId !== 'string' || res.sessionId.length === 0) {
      throw new ComputerError(
        'E_INVALID_ARGUMENT',
        'remote: connect client returned a malformed result — expected { sessionId: string }',
        { got: res === null ? 'null' : typeof res }
      );
    }
    state.operator = createRemoteOperator({ client: state.client, endpoint: checkedEndpoint, sessionId: res.sessionId });
    state.endpoint = checkedEndpoint;
    state.sessionId = res.sessionId;
    return { sessionId: res.sessionId };
  },

  /** remote.screenshot() -> { image, width, height, dpi } (Scope B shape). */
  screenshot() {
    requireSession();
    return state.operator.screenshot();
  },

  /** remote.execute(action) -> { ok, result } | { ok, error } (Scope B shape). */
  execute(action) {
    requireSession();
    return state.operator.execute(action);
  },

  /**
   * remote.vncPreview(sessionId?) -> { url } — pure builder over the
   * connected endpoint; the client seam is never touched (spy count 0).
   */
  vncPreview(sessionId) {
    if (state.endpoint === null) {
      throw new ComputerError(
        'E_REMOTE_UNAVAILABLE',
        'remote: no endpoint — connect first to build a VNC preview URL',
        { configured: state.client !== null, connected: state.operator !== null }
      );
    }
    return buildVncPreviewUrl({
      endpoint: state.endpoint,
      sessionId: sessionId === undefined ? state.sessionId : sessionId,
    });
  },

  /** Session introspection: { sessionId, endpoint } (nulls when unconnected). */
  session() {
    return { sessionId: state.sessionId, endpoint: state.endpoint };
  },

  /** Scope B structural self-check (assertOperator over this facade). */
  assert() {
    return assertOperator(remote);
  },
});

// sanity: the declared capability keys match the Scope B table exactly
// (same key set, same order). A drift here is a programming error.
const capKeys = Object.keys(remote.capabilities);
if (JSON.stringify(capKeys) !== JSON.stringify([...OPERATOR_CAPABILITY_KEYS])) {
  throw new ComputerError(
    'E_INVALID_ARGUMENT',
    'remote: capabilities drift from the Scope B OPERATOR_CAPABILITY_KEYS table',
    { got: capKeys }
  );
}

export {
  REMOTE_CODES,
  REMOTE_CLIENT_METHODS,
  assertRemoteClient,
  validateCredentials,
  createRemoteOperator,
  buildVncPreviewUrl,
};

export default remote;

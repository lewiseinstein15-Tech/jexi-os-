// computer/remote/vnc.js
// Phase 29 Scope J — the VNC preview URL builder.
//
// TARS remote support pairs REST control with a VNC preview of the remote
// VM/browser. JEXI declares the preview CONTRACT only: a PURE url builder.
// No websockify, no noVNC, no socket, no fetch — this module performs zero
// I/O of any kind (no client object exists in its signature), so a probe
// can prove purity with a spy counter that stays at 0.
//
//   buildVncPreviewUrl({ endpoint, sessionId }) -> { url }
//
//     endpoint  absolute http(s) URL of the remote host (no userinfo —
//               credential policy is enforced at connect(), not here)
//     sessionId opaque session id from remote.connect()
//     ->        { url: '<endpoint>/vnc/<sessionId>' }
//
// Pure string assembly over the parsed endpoint: trailing slashes of the
// path collapse, the session id is percent-encoded (deterministic), the
// scheme is preserved. Misuse (non-string/empty inputs, non-http(s)
// endpoint, unparseable URL) -> ComputerError(E_INVALID_ARGUMENT).
// Deterministic: same inputs -> same url, no clock, no randomness.

import { ComputerError } from '../errors.js';

export function buildVncPreviewUrl({ endpoint, sessionId } = {}) {
  if (typeof endpoint !== 'string' || endpoint.length === 0) {
    throw new ComputerError(
      'E_INVALID_ARGUMENT',
      `remote: vnc preview requires a non-empty string endpoint (got ${endpoint === null ? 'null' : typeof endpoint})`,
      { got: endpoint === null ? 'null' : typeof endpoint }
    );
  }
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    throw new ComputerError(
      'E_INVALID_ARGUMENT',
      `remote: vnc preview requires a non-empty string sessionId (got ${sessionId === null ? 'null' : typeof sessionId})`,
      { got: sessionId === null ? 'null' : typeof sessionId }
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
  const base = `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/+$/, '')}`;
  return { url: `${base}/vnc/${encodeURIComponent(sessionId)}` };
}

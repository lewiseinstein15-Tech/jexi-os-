/**
 * JEXI OS — Phase 8 Scope E — RUNTIME-SIDE BRIDGE CLIENT.
 *
 * jexi-net's face of the crossing. The orchestration side signs and sends
 * requests; NOTHING else leaves jexi-net. In PROCESS mode the signed
 * request goes through the identical handler pipeline minus the socket;
 * in DOCKER mode the same envelope is POSTed to the bridge service.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { signRequest, newNonce } from '../../../security/exec-bridge/auth.js';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

/**
 * Docker-mode endpoint of the exec-bridge service (see compose.yaml).
 * Documented constants — the process-mode probes never open this socket,
 * and no Docker output is ever simulated.
 */
export const BRIDGE_ENDPOINT = {
  host: 'exec-bridge',          // compose service name (docker DNS, sandbox-net side)
  port: 8471,
  path: '/v1/exec',
  url: 'http://exec-bridge:8471/v1/exec',
  headers: {
    'content-type': 'application/json',
    'x-jexi-auth': 'jexi-hmac-sha256-v1',
    'x-jexi-signature': '<hex HMAC-SHA256 of canonicalRequest>',
    'x-jexi-caller': '<caller id>',
  },
};

/** Build the HTTP request a docker-mode client would send (transport-agnostic). */
export function buildHttpRequest(request) {
  return {
    method: 'POST',
    url: BRIDGE_ENDPOINT.url,
    headers: { ...BRIDGE_ENDPOINT.headers, 'x-jexi-signature': request.signature, 'x-jexi-caller': request.caller },
    body: JSON.stringify(request),
  };
}

/**
 * Client bound to one bridge instance.
 * - process mode: `bridge` is the local createExecBridge() instance.
 * - docker mode:  pass `httpSend` (transport fn); the same signed envelope
 *   is POSTed to BRIDGE_ENDPOINT. Not exercised here — no Docker in this
 *   sandbox, and simulation is forbidden.
 */
export class ExecBridgeClient {
  constructor({ bridge, caller = 'jexi-net:client', httpSend = null }) {
    if (!bridge) throw new Error('ExecBridgeClient: bridge required');
    this.bridge = bridge;
    this.caller = caller;
    this.httpSend = httpSend; // docker-mode transport (optional)
  }

  /** Sign + send one op. Returns the bridge response envelope. */
  async call(op, args) {
    const request = { op, args, caller: this.caller, ts: Date.now(), nonce: newNonce() };
    request.signature = signRequest(request, this.bridge.key);
    if (this.httpSend) return this.httpSend(buildHttpRequest(request));
    return this.bridge.handle(request);
  }

  /** jexi-net path of the module (for dial-guard bookkeeping). */
  get network() {
    return 'jexi-net';
  }

  /** Absolute path of the bridge module dir (protected from sandbox writes). */
  static get bridgeModuleDir() {
    return path.resolve(MODULE_DIR, '../../security/exec-bridge');
  }
}

export default ExecBridgeClient;

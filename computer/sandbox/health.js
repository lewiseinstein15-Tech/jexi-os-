// computer/sandbox/health.js
// Phase 29 Scope I — the health check contract.
//
// TARS: the AioClient is health-checked at plugin init; a plugin whose
// sandbox is not listening does not come up. JEXI declares the same gate:
//
//   checkHealth(client)   -> { ok, reason?, url? }   total — never throws
//   requireHealthy(client)-> checkHealth result, or THROWS
//                            ComputerError('E_SANDBOX_UNHEALTHY', reason)
//
// checkHealth is a pure function of the injected client: a health() that
// throws, returns a non-object, or returns ok !== true is reported as
// { ok: false, reason } — the reason is the client's own when it provides
// one, and a declared normalization otherwise (never fabricated output —
// a missing reason is described as missing, not invented).
//
// The health call is SYNCHRONOUS by contract (see client.js). A timeout is
// a transport concern and belongs BEHIND the client seam — this module has
// no clock, no timers, no randomness; the same client yields the same
// verdict every time.

import { ComputerError } from '../errors.js';

/**
 * Run one health probe against the injected client. Total: returns a
 * verdict for every input, never throws.
 *   - client without a health() method -> { ok:false, reason: '...' }
 *   - health() throwing                -> { ok:false, reason: 'health() threw: <msg>' }
 *   - non-object health() result       -> { ok:false, reason: 'malformed ...' }
 *   - { ok:false, reason }             -> { ok:false, reason: <client reason> }
 *   - { ok:true, url? }                -> { ok:true, url? } (url kept when a string)
 */
export function checkHealth(client) {
  if (client === null || typeof client !== 'object' || Array.isArray(client) ||
      typeof client.health !== 'function') {
    return { ok: false, reason: 'client does not implement health()' };
  }
  let res;
  try {
    res = client.health();
  } catch (e) {
    const msg = e && typeof e.message === 'string' && e.message.length > 0 ? e.message : String(e);
    return { ok: false, reason: `health() threw: ${msg}` };
  }
  if (res === null || typeof res !== 'object' || Array.isArray(res)) {
    return { ok: false, reason: 'malformed health response: not an object' };
  }
  if (res.ok !== true) {
    const reason =
      typeof res.reason === 'string' && res.reason.length > 0
        ? res.reason
        : 'unhealthy (no reason given)';
    return { ok: false, reason };
  }
  const verdict = { ok: true };
  if (typeof res.url === 'string' && res.url.length > 0) verdict.url = res.url;
  return verdict;
}

/**
 * Init gate: require a healthy client or refuse init.
 * Throws ComputerError('E_SANDBOX_UNHEALTHY') carrying the client's reason
 * in both the message and details. Returns the verdict otherwise.
 */
export function requireHealthy(client) {
  const verdict = checkHealth(client);
  if (!verdict.ok) {
    throw new ComputerError(
      'E_SANDBOX_UNHEALTHY',
      `sandbox health check failed: ${verdict.reason}`,
      { reason: verdict.reason }
    );
  }
  return verdict;
}

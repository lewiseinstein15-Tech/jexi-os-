// computer/sandbox/client.js
// Phase 29 Scope I — the AIO-compatible sandbox client interface (SEAM).
//
// TARS AIO Sandbox lineage: an isolated all-in-one execution environment for
// bash, Jupyter and file operations, consumed through a client that is
// health-checked at init (AioClient) and handed to the agent plugin
// (CodeAgentPlugin). JEXI ports the CONTRACT, never the transport: the
// client object is INJECTED by the host (configure seam in index.js). This
// module declares the required client surface and validates it. It never
// constructs a client, never touches the network, and never fakes execution
// output — a sandbox without an injected client is simply unavailable.
//
// Declared client surface (synchronous; an async transport adapts BEHIND the
// seam by resolving before injection — determinism over convenience):
//
//   client.health()                 -> { ok: true, url? } |
//                                      { ok: false, reason }
//   client.execBash({ cmd })        -> { stdout, stderr, exitCode, refusal? }
//   client.runJupyter({ code })     -> { stdout, stderr, exitCode, refusal? }
//   client.readFile({ path })       -> { content }
//   client.writeFile({ path, content }) -> { ok }
//
// Declared error semantics (health.js / exec.js enforce the same layering):
// - Sandbox environment failures (no client, failed health check, refused
//   execution) are ComputerError with the Scope I codes below.
// - Misuse (malformed arguments, incomplete client object, malformed client
//   response) is ComputerError(E_INVALID_ARGUMENT) — fail fast, never guess.
//
// All errors ride ComputerError (computer/errors.js) — zero new classes,
// zero new dependencies, no clock, no randomness.

import { ComputerError } from '../errors.js';

// Error codes declared by Scope I. Every one is carried by ComputerError —
// no new error class. E_INVALID_ARGUMENT is REUSED from Scope A (misuse).
export const SANDBOX_CODES = Object.freeze([
  'E_SANDBOX_UNAVAILABLE',  // no client configured — the sandbox is absent
  'E_SANDBOX_UNHEALTHY',    // health check failed at init (with the reason)
  'E_SANDBOX_EXEC_FAILED',  // exec returned non-zero with a refusal reason
]);

/**
 * The declared AIO-compatible client surface, frozen. `result` documents the
 * response shape each method must return (validated by exec.js / health.js —
 * a malformed client response is misuse, E_INVALID_ARGUMENT, never guessed).
 */
export const SANDBOX_CLIENT_METHODS = Object.freeze([
  Object.freeze({ method: 'health', result: '{ ok: true, url? } | { ok: false, reason }' }),
  Object.freeze({ method: 'execBash', result: '{ stdout, stderr, exitCode, refusal? }' }),
  Object.freeze({ method: 'runJupyter', result: '{ stdout, stderr, exitCode, refusal? }' }),
  Object.freeze({ method: 'readFile', result: '{ content }' }),
  Object.freeze({ method: 'writeFile', result: '{ ok }' }),
]);

/**
 * Structural check: does this object satisfy the AIO-compatible client
 * contract? Mirrors Scope B assertOperator / Scope H assertEngineShape.
 * Throws ComputerError(E_INVALID_ARGUMENT) on a shape violation; returns
 * true otherwise.
 */
export function assertClient(client) {
  const fail = (field) => {
    throw new ComputerError(
      'E_INVALID_ARGUMENT',
      `sandbox: client does not satisfy the AIO contract: ${field}`,
      {
        field,
        got: client && typeof client === 'object' ? Object.keys(client) : typeof client,
      }
    );
  };
  if (!client || typeof client !== 'object' || Array.isArray(client)) fail('not an object');
  const missing = SANDBOX_CLIENT_METHODS.filter((m) => typeof client[m.method] !== 'function');
  if (missing.length > 0) {
    throw new ComputerError(
      'E_INVALID_ARGUMENT',
      `sandbox: client must implement ${SANDBOX_CLIENT_METHODS.map((m) => m.method).join('/')} (missing: ${missing.map((m) => m.method).join(', ')})`,
      { missing: missing.map((m) => m.method) }
    );
  }
  return true;
}

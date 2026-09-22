// computer/sandbox/index.js
// Phase 29 Scope I — public surface of the sandbox integration.
//
//   sandbox.available()            -> { available, url? }
//   sandbox.exec({ cmd })          -> { stdout, stderr, exitCode }
//   sandbox.jupyter({ code })      -> { stdout, stderr, exitCode }   (declared
//                                     extra per BUILD: bash / jupyter / file ops)
//   sandbox.read({ path })         -> { content }
//   sandbox.write({ path, content }) -> { ok }
//   sandbox.configure({ client, url?, root?, skipHealthCheck? })
//                                  -> { ok, url, root, healthChecked }
//   sandbox.detach()               -> { detached: true }
//   sandbox.root()                 -> current sandbox root string
//
// LIFECYCLE (TARS AioClient at plugin init): the host INJECTS an
// AIO-compatible client via configure(), which runs the health gate unless
// skipHealthCheck is true (the declared bypass). A failed health check
// refuses init and leaves the previous state untouched. configure may be
// called again to REPLACE the client (declared REPLACE semantics). Unconfigured
// (the sandbox environment without an AIO service): available() is
// { available: false } and every operation refuses with E_SANDBOX_UNAVAILABLE.
//
// The client is a SEAM — injected, never constructed here, never faked.
// available() reports the CONFIGURATION state (a client is attached); the
// health proof happened at init (or was explicitly skipped).
//
// Deterministic given the same injected client: closure state, frozen
// surface, no clock, no randomness, no host I/O anywhere in this module.
//
// Re-exports: SANDBOX_CODES / SANDBOX_CLIENT_METHODS / SANDBOX_CONTRACT /
// assertClient / checkHealth / requireHealthy / DEFAULT_ROOT / assertRoot /
// resolvePath. All errors are ComputerError — zero new classes, zero new
// dependencies.

import { ComputerError } from '../errors.js';
import { SANDBOX_CODES, SANDBOX_CLIENT_METHODS, assertClient } from './client.js';
import { checkHealth, requireHealthy } from './health.js';
import {
  DEFAULT_ROOT,
  assertRoot,
  resolvePath,
  execBash,
  runJupyter,
  readFile,
  writeFile,
} from './exec.js';

/** The declared Scope I contract methods (jupyter is a declared extra). */
export const SANDBOX_CONTRACT = Object.freeze(['available', 'exec', 'read', 'write']);

// Closure state — mutated only by configure/detach, only after validation.
const state = {
  client: null,
  url: null,
  root: DEFAULT_ROOT,
  health: null,
};

export const sandbox = Object.freeze({
  /**
   * Attach an AIO-compatible client. Validation order (declared, nothing
   * mutates until every step passes):
   *   1. client object shape        -> E_INVALID_ARGUMENT
   *   2. root (when provided)       -> E_INVALID_ARGUMENT
   *   3. url (when provided)        -> E_INVALID_ARGUMENT
   *   4. health gate (unless skip)  -> E_SANDBOX_UNHEALTHY with the reason
   * A configure url is kept as-is; without one, the client's health url is
   * adopted when present. skipHealthCheck === true is the DECLARED bypass
   * (health() is never invoked).
   */
  configure({ client, url, root, skipHealthCheck } = {}) {
    if (client === null || typeof client !== 'object' || Array.isArray(client)) {
      throw new ComputerError(
        'E_INVALID_ARGUMENT',
        `sandbox: configure requires a client object (got ${client === null ? 'null' : typeof client})`,
        { got: client === null ? 'null' : typeof client }
      );
    }
    assertClient(client);
    const nextRoot = root === undefined ? state.root : assertRoot(root);
    let nextUrl = null;
    if (url !== undefined) {
      if (typeof url !== 'string' || url.length === 0) {
        throw new ComputerError(
          'E_INVALID_ARGUMENT',
          `sandbox: url must be a non-empty string when provided (got ${typeof url})`,
          { got: typeof url }
        );
      }
      nextUrl = url;
    }
    let health = null;
    if (skipHealthCheck !== true) {
      health = requireHealthy(client); // throws E_SANDBOX_UNHEALTHY — state unchanged
      if (nextUrl === null && typeof health.url === 'string') nextUrl = health.url;
    }
    state.client = client;
    state.url = nextUrl;
    state.root = nextRoot;
    state.health = health;
    return { ok: true, url: nextUrl, root: nextRoot, healthChecked: skipHealthCheck !== true };
  },

  /** Detach the client and reset to the declared defaults (probe/di hygiene). */
  detach() {
    state.client = null;
    state.url = null;
    state.root = DEFAULT_ROOT;
    state.health = null;
    return { detached: true };
  },

  /** Configuration state: a client is attached -> available. Never re-probes health. */
  available() {
    if (state.client === null) return { available: false };
    return state.url !== null ? { available: true, url: state.url } : { available: true };
  },

  /** bash inside the sandbox: { cmd } -> { stdout, stderr, exitCode }. */
  exec(params) {
    return execBash(state, params);
  },

  /** one Jupyter cell: { code } -> { stdout, stderr, exitCode }. */
  jupyter(params) {
    return runJupyter(state, params);
  },

  /** read a sandbox file: { path } -> { content }. */
  read(params) {
    return readFile(state, params);
  },

  /** write a sandbox file: { path, content } -> { ok }. */
  write(params) {
    return writeFile(state, params);
  },

  /** Current sandbox root (introspection). */
  root() {
    return state.root;
  },
});

export {
  SANDBOX_CODES,
  SANDBOX_CLIENT_METHODS,
  assertClient,
  checkHealth,
  requireHealthy,
  DEFAULT_ROOT,
  assertRoot,
  resolvePath,
};

export default sandbox;

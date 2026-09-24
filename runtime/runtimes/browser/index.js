/**
 * JEXI OS — Phase 17 Scope A — BROWSER RUNTIME FACADE.
 *
 *   const rt = await createBrowserRuntime({ stealth: true });
 *   rt.status()          → transport, version, CDP url, RSS, identity warnings
 *   rt.engine            → the ObscuraEngine
 *   rt.connectPlaywright() → a connected playwright Browser (needs playwright installed)
 *   await rt.stop();
 *
 * One engine, two transports (local process / Docker), no Chromium fallback.
 * The CDP contract is the seam: anything that speaks CDP — Playwright's
 * `chromium.connectOverCDP`, browser-use's CDP transport, a raw websocket —
 * attaches to the same endpoint without knowing how it was started.
 */

import { createObscuraEngine, findObscuraBinary, obscuraVersion, dockerAvailable, DEFAULT_SEARCH_PATHS, DEFAULT_PORT, DEFAULT_HOST } from './engine.js';
import { assertObscura, describeUnavailability, ObscuraUnavailableError, assertEngineIsObscura } from './fallback.js';
import { buildStealthEnv, checkIdentityConsistency, STEALTH_CAPABILITIES, STEALTH_ENV_SPEC } from './stealth.js';

export {
  createObscuraEngine, findObscuraBinary, obscuraVersion, dockerAvailable,
  assertObscura, describeUnavailability, ObscuraUnavailableError, assertEngineIsObscura,
  buildStealthEnv, checkIdentityConsistency, STEALTH_CAPABILITIES, STEALTH_ENV_SPEC,
  DEFAULT_SEARCH_PATHS, DEFAULT_PORT, DEFAULT_HOST,
};

/**
 * Probe whether Obscura can be provided here, WITHOUT starting it.
 * Never throws — returns the honest verdict so probes can report it.
 *
 * @param {{searchPaths?: string[]}} [o]
 */
export function obscuraAvailability({ searchPaths = DEFAULT_SEARCH_PATHS } = {}) {
  const binary = findObscuraBinary(searchPaths);
  const docker = dockerAvailable();
  let transport = null;
  let error = null;
  try {
    transport = assertObscura({ binary, docker, searched: searchPaths });
  } catch (e) {
    error = e.message;
  }
  return {
    available: Boolean(transport),
    transport,
    binary,
    binary_version: binary ? obscuraVersion(binary) : null,
    docker,
    error,
    ...(transport ? {} : describeUnavailability({ reason: error })),
  };
}

/**
 * Build the runtime. Fails loudly when Obscura is absent (no Chromium fallback).
 *
 * @param {object} [o] forwarded to ObscuraEngine, plus:
 * @param {boolean} [o.autostart=true]
 */
export async function createBrowserRuntime(o = {}) {
  const { autostart = true, ...engineOpts } = o;
  const engine = createObscuraEngine(engineOpts);
  const rt = {
    engine,
    transport: null,
    up: null,
    status: () => engine.status(),
    cdpUrl: engine.cdpUrl,

    async start() {
      rt.up = await engine.start();
      rt.transport = rt.up.transport;
      return rt.up;
    },

    async stop() {
      await engine.stop();
      rt.up = null;
    },

    /**
     * Connect Playwright over CDP. Playwright is an optional dependency — the
     * runtime reports a clear error rather than bundling a browser driver.
     */
    async connectPlaywright() {
      let chromium;
      try {
        ({ chromium } = await import('playwright'));
      } catch {
        throw new Error('connectPlaywright: playwright is not installed in this runtime — `npm i playwright` (the CDP endpoint needs no browser download)');
      }
      const browser = await chromium.connectOverCDP(engine.cdpUrl);
      return browser;
    },
  };
  if (autostart) await rt.start();
  return rt;
}

export default { createBrowserRuntime, obscuraAvailability };

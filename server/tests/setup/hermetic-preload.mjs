/**
 * M8 — HERMETIC TEST PRELOAD.
 *
 * Loaded via `--import` (absolute path) by the test runner BEFORE any test
 * module or application module initializes. It does two things, in order:
 *
 *   1. Marks the process as a test process (`JEXI_TEST_HARNESS=1`) so product
 *      code can skip test-hostile side effects (e.g. spawning a language
 *      server). Plain-script suites need this because `node --test`'s
 *      NODE_TEST_CONTEXT does not exist for them.
 *   2. Installs a test-level EGRESS GUARD over every outbound transport this
 *      process can reach: global `fetch` (undici), `node-fetch`, and the
 *      `node:http`/`node:https` request functions (axios and other clients
 *      funnel through those). A request to a non-loopback host throws a loud
 *      error instead of silently leaving the machine. Loopback (local test
 *      servers) keeps working.
 *
 * The guard is what makes the suite hermetic: it blocks at the transport, so
 * determinism does not depend on re-classifying providers or on the network
 * policy. It is a loud failure rather than silent egress — exactly what the
 * pre-M8 "accidental remote AI provider" flakes were.
 *
 * `fetch` is patched as a global, and `node-fetch` calls `http.request`, so
 * patching the four `node:http(s)` functions + `globalThis.fetch` covers every
 * outbound path in this codebase (verified: no `src` module captures
 * `globalThis.fetch` into a module-scope binding at import time, and no `src`
 * module uses ESM *named* imports of `node:http`/`node:https` — those bindings
 * are read-only and immune to patching, but only the default object / CJS
 * `require` form is used by the transports that actually dial).
 *
 * Opt-outs (explicit, and reported so a run is never silently non-hermetic):
 *   JEXI_TEST_ALLOW_EGRESS=1       disable the egress guard entirely
 *   JEXI_TEST_NETWORK_POLICY=...   set JEXI_NETWORK_POLICY for the run
 *                                  (e.g. `local-only` for a strict run)
 */

import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/* ── 1. test-process marker ──────────────────────────────────────────────── */

// Marks every process the harness preloads (plain scripts included, which
// `node --test`'s NODE_TEST_CONTEXT would not cover). Product code uses it to
// skip test-hostile side effects such as spawning a language server.
process.env.JEXI_TEST_HARNESS = '1';

// The network policy is left at its product default (`allow-remote`). The
// egress guard below is what enforces hermeticity: it blocks the transport, so
// determinism does not depend on re-classifying providers. A suite that wants
// the policy seam can still set JEXI_NETWORK_POLICY itself (as the policy and
// judge-gates suites already do); JEXI_TEST_NETWORK_POLICY is a convenience
// alias for setting it from the outer command line.
if (process.env.JEXI_TEST_NETWORK_POLICY && !process.env.JEXI_NETWORK_POLICY) {
  process.env.JEXI_NETWORK_POLICY = process.env.JEXI_TEST_NETWORK_POLICY;
}

/* ── 2. egress guard ─────────────────────────────────────────────────────── */

const ALLOW_EGRESS = process.env.JEXI_TEST_ALLOW_EGRESS === '1';

/** Loopback detection comes from the ONE policy module, never duplicated. */
const { isLoopbackUrl } = await import(
  pathToFileURL(path.join(HERE, '../../src/services/NetworkPolicy.js')).href
);

/** Every non-loopback dial the guard refused (available for assertions). */
export const refusedEgress = [];

function refuse(url, transport) {
  const entry = { url: String(url), transport, at: Date.now() };
  refusedEgress.push(entry);
  throw new Error(
    `EGRESS GUARD: hermetic test attempted a non-loopback ${transport} to ${entry.url}.\n` +
    'Tests must not depend on external services. If this suite genuinely needs\n' +
    'them, set JEXI_TEST_ALLOW_EGRESS=1 and keep it out of offline CI.'
  );
}

/** Best-effort URL from fetch/node-fetch/http arguments. '' when unresolvable. */
function urlFromArgs(input, options) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  if (input && typeof input.href === 'string') return input.href; // node-fetch Request
  if (input && typeof input.url === 'string') return input.url;
  const o = (options && typeof options === 'object') ? options
    : (input && typeof input === 'object' && !(input instanceof URL)) ? input : null;
  const host = o && (o.hostname || o.host);
  if (host) {
    const scheme = o.protocol || 'http:';
    const port = o.port ? `:${o.port}` : '';
    return `${scheme}//${host}${port}${o.path || '/'}`;
  }
  return '';
}

function guard(target, fn, transport) {
  const original = target[fn];
  if (typeof original !== 'function' || original.__hermeticGuard) return;
  const wrapped = function (input, options, ...rest) {
    if (!ALLOW_EGRESS) {
      const url = urlFromArgs(input, options);
      // Unknown target fails CLOSED: only a provably loopback URL may pass.
      if (!url || !isLoopbackUrl(url)) refuse(url || `(unresolvable ${transport} target)`, transport);
    }
    return original.call(this, input, options, ...rest);
  };
  wrapped.__hermeticGuard = true;
  target[fn] = wrapped;
}

if (!ALLOW_EGRESS) {
  const g = globalThis.fetch;
  if (typeof g === 'function' && !g.__hermeticGuard) {
    const wrapped = async function (input, init) {
      const url = urlFromArgs(input, init);
      if (!url || !isLoopbackUrl(url)) refuse(url || '(unresolvable fetch target)', 'fetch');
      return g.call(this, input, init);
    };
    wrapped.__hermeticGuard = true;
    globalThis.fetch = wrapped;
  }
  guard(http, 'request', 'http.request');
  guard(http, 'get', 'http.get');
  guard(https, 'request', 'https.request');
  guard(https, 'get', 'https.get');
}

process.on('exit', () => {
  if (refusedEgress.length) {
    // Never silent: report refusals even if the suite forgot to assert on them.
    console.error(
      `[hermetic-preload] refused ${refusedEgress.length} non-loopback request(s): ` +
      refusedEgress.map((r) => r.url).join(', ')
    );
  }
});

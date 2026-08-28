/**
 * B160 — NODE COMPAT SHIM.
 *
 * jsdom@30 bundles an undici whose webidl does
 * `const { markAsUncloneable } = require('node:worker_threads')` and calls it
 * at module-load time (CacheStorage). worker_threads.markAsUncloneable only
 * exists on Node ≥ 22 — on Node 20 every jsdom import crashed with
 * `TypeError: webidl.util.markAsUncloneable is not a function`.
 *
 * The real helper only marks an object uncloneable for structuredClone(); a
 * no-op is behavior-safe for JEXI's use of jsdom (HTML→DOM parsing).
 * Must be imported BEFORE jsdom (first import in Extractor.js), and because
 * CJS built-ins share one module object, the patch reaches undici's require.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

for (const mod of ['node:worker_threads', 'node:util']) {
  try {
    const m = require(mod);
    if (typeof m.markAsUncloneable !== 'function') {
      m.markAsUncloneable = function markAsUncloneable(o) { return o; };
    }
  } catch {
    /* module unavailable — nothing to patch */
  }
}

export const nodeCompatOk = true;

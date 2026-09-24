/**
 * JEXI OS — PHASE 31 SCOPE 5 — S4-REPOCTX: semantica/repo-map -> session bootstrap.
 *
 * The shipped repo-map builder (semantica/repo-map, READ-ONLY — cached,
 * budget-bounded scan/rank/summarize) becomes reachable from the session
 * bootstrap context path through the SAME registerSource seam the earlier
 * Phase 31 scopes used (brain-hybrid / brain-hot / viking / session history).
 * The map is built lazily on first produce (the shipped cache makes repeats
 * cheap) and every section carries the real numbers — no filler.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoMap, DEFAULT_BUDGET } from '../../../services/semantica/repo-map/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(HERE, '..', '..');
const REPO_ROOT = path.resolve(SERVER_ROOT, '..');

export function initRepoCtx(opts = {}) {
  // Bounded default: the server source tree the session actually boots and
  // works in. The shipped rank() is O(N^2) over file contents, which is
  // minutes on a repo-wide scan (4453+ files) — a consumer-side scope
  // decision, disclosed in the Scope 5 report. Callers may pass any root
  // (e.g. { root: REPO_ROOT }) and accept that cost; the accessor does not
  // change the shipped module.
  const root = opts.root || path.join(SERVER_ROOT, 'src');
  const budget = opts.budget || DEFAULT_BUDGET;

  function map(over = {}) {
    return repoMap.build(root, { budget: over.budget || budget });
  }

  return { map, root, budget, invalidate: () => repoMap.invalidate(root) };
}

export default initRepoCtx;

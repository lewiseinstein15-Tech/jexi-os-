/**
 * JEXI OS — Phase 27 Scope B — repo map adapter (session-facing surface).
 *
 *   repoContext.forSession(root, { budget? }) -> { summary, tokens, cached }   (async)
 *   repoContext.invalidate(root)              -> { cleared }                   (async)
 *   repoContext.available()                   -> { available: true }
 *                                            |  { available: false, reason }   (async)
 *
 * THIN ADAPTER over Phase 14 Scope F (semantica/repo-map) — that module is
 * the SINGLE SOURCE OF TRUTH. Nothing here re-ranks, re-summarizes, or
 * re-caches:
 *   - forSession() is a pass-through of repoMap.build(), which already
 *     serves from its own disk cache when the manifest key (path + mtime +
 *     size hash) matches — a cache read never rebuilds. `cached` mirrors
 *     Phase 14's own hit/miss report (res.cache === 'hit'); this adapter
 *     adds no caching layer of its own.
 *   - invalidate() delegates 1:1 to repoMap.invalidate() and returns its
 *     { cleared } result unchanged.
 *   - Determinism is inherited: same root + same mtimes -> same manifest
 *     key -> same summary bytes. The adapter introduces no randomness,
 *     no time, no network.
 *
 * Default budget is Phase 14's own DEFAULT_BUDGET (1000 tokens): the
 * adapter forwards `budget` as given and an omitted budget falls through
 * to Phase 14's destructuring default.
 *
 * Availability contract: if Phase 14 F is not importable (module absent
 * or exposing no usable repoMap surface), callers get the typed
 * E_REPO_MAP_UNAVAILABLE — never a silent fallback to a stub summary.
 * The module is resolved lazily via dynamic import relative to THIS file
 * (repo-root/semantica/repo-map/index.js), so a missing Phase 14 F cannot
 * crash the rest of the routing surface at load time.
 *
 * _internals.resolveModuleUrl is a seam for probes/tests to simulate the
 * module being missing (point it at a nonexistent path); production code
 * never touches it.
 *
 * Errors: E_REPO_MAP_UNAVAILABLE, E_INVALID_ROOT, E_INVALID_BUDGET.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { RoutingError } from './_internal.js';

export { RoutingError } from './_internal.js';

export const _internals = {
  resolveModuleUrl() {
    // dirname(file) = providers/routing -> .. -> providers -> .. -> repo root
    return pathToFileURL(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'semantica', 'repo-map', 'index.js')
    ).href;
  },
};

/**
 * Resolves + imports Phase 14 F and asserts its public surface before
 * handing it over. Every public adapter call goes through here, so a
 * missing or shape-drifted Phase 14 F always surfaces as
 * E_REPO_MAP_UNAVAILABLE at call time.
 */
async function importRepoMap() {
  let mod;
  try {
    mod = await import(_internals.resolveModuleUrl());
  } catch (err) {
    throw new RoutingError(
      'E_REPO_MAP_UNAVAILABLE',
      `semantica/repo-map is not importable (${err && err.code ? err.code : String(err)})`
    );
  }
  const repoMap = mod && mod.repoMap;
  if (!repoMap || typeof repoMap.build !== 'function' || typeof repoMap.invalidate !== 'function') {
    throw new RoutingError(
      'E_REPO_MAP_UNAVAILABLE',
      'semantica/repo-map is importable but exposes no usable repoMap surface (build/invalidate)'
    );
  }
  return repoMap;
}

function assertRoot(root) {
  if (typeof root !== 'string' || root.trim() === '') {
    throw new RoutingError('E_INVALID_ROOT', `invalid repo root ${JSON.stringify(root)}`);
  }
  let st = null;
  try {
    st = fs.statSync(root);
  } catch {
    /* ENOENT or unreadable -> handled below */
  }
  if (!st || !st.isDirectory()) {
    throw new RoutingError('E_INVALID_ROOT', `repo root is not an existing directory: ${root}`);
  }
}

function assertBudget(budget) {
  if (budget === undefined) return; // falls through to Phase 14's DEFAULT_BUDGET (1000)
  if (typeof budget !== 'number' || !Number.isFinite(budget) || budget <= 0) {
    throw new RoutingError(
      'E_INVALID_BUDGET',
      `budget must be a positive finite number of tokens, got ${JSON.stringify(budget)}`
    );
  }
}

/**
 * forSession(root, { budget? }) -> { summary, tokens, cached }
 *
 * Session bootstrap / chat runtime entry point. Returns the ranked
 * codebase summary under the token budget exactly as Phase 14 F produced
 * it. `cached` is TRUE when Phase 14's disk cache was hit (no rebuild
 * happened inside Phase 14), FALSE on a fresh build. The adapter never
 * caches again.
 */
export async function forSession(root, { budget } = {}) {
  assertRoot(root);
  assertBudget(budget);
  const repoMap = await importRepoMap();
  const res = repoMap.build(root, { budget });
  return { summary: res.summary, tokens: res.tokens, cached: res.cache === 'hit' };
}

/**
 * invalidate(root) -> { cleared }
 *
 * Delegates 1:1 to Phase 14 F's invalidate()/clearRoot. Clears every
 * cache key Phase 14 recorded for this root; the next forSession() is a
 * fresh build.
 */
export async function invalidate(root) {
  assertRoot(root);
  const repoMap = await importRepoMap();
  return repoMap.invalidate(root);
}

/**
 * available() -> { available: true } | { available: false, reason }
 *
 * Resolves + imports Phase 14 F and checks its surface without building
 * anything. reason carries the typed code + underlying cause when the
 * module is unavailable.
 */
export async function available() {
  try {
    await importRepoMap();
    return { available: true };
  } catch (err) {
    return { available: false, reason: `${err.code}: ${err.message}` };
  }
}

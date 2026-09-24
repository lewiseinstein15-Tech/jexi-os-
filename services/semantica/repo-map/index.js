/**
 * JEXI OS — Phase 14 Scope F — repo map entry point.
 *
 *   repoMap.build(root, { budget })  -> { files, summary, tokens, cache, key }
 *   repoMap.cache(root)              -> { hit, key } | { miss, key }
 *   repoMap.invalidate(root)         -> { cleared }
 *
 * build() serves from the disk cache when the manifest key (path +
 * mtime + size hash) matches — a cache read never rebuilds. Standalone
 * by design: nothing enters the context graph here.
 */
import { rank, scan } from './rank.js';
import { summarize, DEFAULT_BUDGET, MAX_LINE, TOP_KEEP } from './summarize.js';
import { keyFor, has, load, save, clearRoot } from './cache.js';

export const repoMap = {
  build(root, { budget = DEFAULT_BUDGET } = {}) {
    const key = keyFor(root, budget);
    const cached = has(key) ? load(key) : null;
    if (cached) return { ...cached.value, cache: 'hit', key };
    const value = summarize(root, rank(root), { budget });
    save(root, key, value);
    return { ...value, cache: 'miss', key };
  },
  cache(root) {
    const key = keyFor(root, DEFAULT_BUDGET);
    return has(key) ? { hit: true, key } : { miss: true, key };
  },
  invalidate(root) {
    return clearRoot(root);
  },
  rank,
  scan,
  DEFAULT_BUDGET,
  MAX_LINE,
  TOP_KEEP,
};

export { rank, scan, summarize, DEFAULT_BUDGET, MAX_LINE, TOP_KEEP };
export { SemanticaError } from '../_internal.js';

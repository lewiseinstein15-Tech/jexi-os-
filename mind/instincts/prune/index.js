/**
 * JEXI OS — Phase 26 Scope F — TTL pruning entry point.
 *
 *   const pruner = createPruner(root)
 *   pruner.run(projectId, { ttl?, minConfidence? })    -> { pruned, ids }
 *   pruner.dryRun(projectId, { ttl?, minConfidence? }) -> { would, ids, details }
 *
 * Defaults declared in ttl.js: ttl = 100 op-seq, minConfidence = 0.5.
 * Built on Scope A projectDir/currentOp and Scope C readAll — no
 * reimplementation. Unknown project -> empty result (declared).
 */
import fs from 'node:fs';
import { fail } from '../../../services/semantica/_internal.js';
import { run, dryRun } from './prune.js';
import { DEFAULT_TTL, DEFAULT_MIN_CONFIDENCE, resolveOpts, isStale } from './ttl.js';

export function createPruner(root) {
  if (typeof root !== 'string' || root.trim() === '') {
    throw fail('E_INVALID_ARGUMENT', 'root must be a non-empty string');
  }
  fs.mkdirSync(root, { recursive: true });
  return {
    path: root,
    DEFAULT_TTL,
    DEFAULT_MIN_CONFIDENCE,
    run: (projectId, opts) => run(root, projectId, opts),
    dryRun: (projectId, opts) => dryRun(root, projectId, opts),
  };
}

export { run, dryRun } from './prune.js';
export { DEFAULT_TTL, DEFAULT_MIN_CONFIDENCE, resolveOpts, isStale } from './ttl.js';
export { SemanticaError } from '../../../services/semantica/_internal.js';

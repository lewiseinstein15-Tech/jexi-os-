/**
 * JEXI OS — Phase 26 Scope C — instinct store entry point.
 *
 *   const store = createInstinctStore(root)
 *   store.save(instinct)                        -> { saved, id, confidence }
 *   store.get(instinctId, { projectId })        -> instinct
 *   store.list(projectId, { minConfidence?, action? }) -> instinct[] (confidence desc, id asc)
 *   store.prune(projectId, { olderThanOpSeq })  -> { pruned, ids }
 *
 * Same project-scoped root and file layout as Scopes A/B — Scope A
 * provides projectDir/nextOp/currentOp, Scope B provides
 * loadInstinct/saveInstinct/computeConfidence. Nothing re-implemented.
 */
import fs from 'node:fs';
import { fail } from '../../../services/semantica/_internal.js';
import { save, get, prune, PRUNE_CONFIDENCE_CEILING } from './store.js';
import { list, readAll } from './query.js';

export function createInstinctStore(root) {
  if (typeof root !== 'string' || root.trim() === '') {
    throw fail('E_INVALID_ARGUMENT', 'root must be a non-empty string');
  }
  fs.mkdirSync(root, { recursive: true });
  return {
    path: root,
    PRUNE_CONFIDENCE_CEILING,
    save: (instinct) => save(root, instinct),
    get: (instinctId, ctx) => get(root, instinctId, ctx),
    list: (projectId, filter) => list(root, projectId, filter),
    prune: (projectId, opts) => prune(root, projectId, opts),
    readAll: (projectId) => readAll(root, projectId),
  };
}

export { save, get, prune, PRUNE_CONFIDENCE_CEILING } from './store.js';
export { list, readAll } from './query.js';
export { SemanticaError } from '../../../services/semantica/_internal.js';

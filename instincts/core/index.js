/**
 * JEXI OS — Phase 26 Scope B — instincts core entry point.
 *
 *   const instincts = createInstincts(root)
 *   instincts.create({ projectId, action, evidence?, examples?, id? }) -> instinct
 *   instincts.get(projectId, instinctId)   -> instinct   (E_UNKNOWN_INSTINCT)
 *   instincts.validate(instinct)           -> { valid, errors? }
 *   instincts.score(instinct)              -> { score, signals }
 *   instincts.reinforce(instinctId, { evidence, projectId }) -> updated
 *   instincts.contradict(instinctId, { evidence, projectId }) -> updated
 *
 * Persistence: <root>/projects/<projectId>/instincts/<id>.json — the
 * same project-scoped root as Scope A. Timestamps are op-seq numbers
 * (no clocks). Confidence is always recomputed from the DECLARED
 * formula in confidence.js. Phase 14 SemanticaError reused read-only.
 */
import fs from 'node:fs';
import { fail } from '../../semantica/_internal.js';
import { assertProjectId } from '../observe/scope.js';
import { nextOp } from '../observe/queue.js';
import { create, validate } from './schema.js';
import { score, reinforce, contradict, loadInstinct, saveInstinct, computeConfidence, MODEL } from './confidence.js';

export function createInstincts(root) {
  if (typeof root !== 'string' || root.trim() === '') {
    throw fail('E_INVALID_ARGUMENT', 'root must be a non-empty string');
  }
  fs.mkdirSync(root, { recursive: true });
  return {
    path: root,
    MODEL,
    create(spec) {
      const at = nextOp(root);
      const instinct = create(spec, at);
      const v = validate(instinct);
      if (!v.valid) {
        throw fail('E_INVALID_INSTINCT', 'created instinct failed validation: ' + v.errors.map((e) => e.field).join(', '));
      }
      saveInstinct(root, instinct.projectId, instinct);
      return { ...instinct };
    },
    get: (projectId, instinctId) => loadInstinct(root, assertProjectId(projectId), instinctId),
    validate,
    score,
    computeConfidence,
    reinforce: (instinctId, spec) => reinforce(root, instinctId, { ...spec, projectId: assertProjectId(spec && spec.projectId) }),
    contradict: (instinctId, spec) => contradict(root, instinctId, { ...spec, projectId: assertProjectId(spec && spec.projectId) }),
  };
}

export { create, validate } from './schema.js';
export { score, reinforce, contradict, computeConfidence, MODEL } from './confidence.js';
export { SemanticaError } from '../../semantica/_internal.js';

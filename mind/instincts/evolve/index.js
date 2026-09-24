/**
 * JEXI OS — Phase 26 Scope D — /evolve entry point.
 *
 *   const ev = createEvolve(root)
 *   ev.cluster(projectId, { minConfidence?, minClusterSize?, minPrefixLength? }) -> clusters[]
 *   ev.evolve(clusterId, { kind, projectId, ... })  -> { artifact }
 *   ev.status(clusterId, { projectId })             -> { state, ... }
 *
 * Built on Scope C's list() and Scope A's op-seq. Artifacts and
 * cluster state live under the instincts root only.
 */
import fs from 'node:fs';
import { fail } from '../../semantica/_internal.js';
import { cluster, DEFAULTS, clusterIdOf, related, evidenceSignature } from './cluster.js';
import { evolve, status } from './evolve.js';
import { KINDS } from './emit.js';

export function createEvolve(root) {
  if (typeof root !== 'string' || root.trim() === '') {
    throw fail('E_INVALID_ARGUMENT', 'root must be a non-empty string');
  }
  fs.mkdirSync(root, { recursive: true });
  return {
    path: root,
    DEFAULTS,
    KINDS,
    cluster: (projectId, opts) => cluster(root, projectId, opts),
    evolve(clusterId, opts = {}) {
      if (!opts.projectId) throw fail('E_INVALID_ARGUMENT', 'evolve requires opts.projectId');
      return evolve(root, opts.projectId, clusterId, opts);
    },
    status(clusterId, opts = {}) {
      if (!opts.projectId) throw fail('E_INVALID_ARGUMENT', 'status requires opts.projectId');
      return status(root, opts.projectId, clusterId);
    },
  };
}

export { cluster, clusterIdOf, related, evidenceSignature, DEFAULTS } from './cluster.js';
export { evolve, status } from './evolve.js';
export { KINDS, buildArtifact } from './emit.js';
export { SemanticaError } from '../../semantica/_internal.js';

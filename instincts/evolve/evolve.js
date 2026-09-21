/**
 * JEXI OS — Phase 26 Scope D — /evolve: cluster -> skill | command | agent.
 *
 * evolve(root, projectId, clusterId, { kind }) check order (declared):
 *   1. kind in KINDS                 -> else E_UNKNOWN_KIND
 *   2. already evolved on disk       -> E_ALREADY_EVOLVED
 *   3. recompute components; id not found among them -> E_UNKNOWN_CLUSTER
 *   4. component size < minClusterSize -> E_CLUSTER_BELOW_THRESHOLD
 *   5. emit structured artifact (op-seq generatedAt) + state 'evolved'
 *
 * status(root, projectId, clusterId) -> { state: 'evolved'|'candidate', ... }
 */
import { fail } from '../../semantica/_internal.js';
import { assertProjectId } from '../observe/scope.js';
import { nextOp } from '../observe/queue.js';
import { list } from '../store/query.js';
import { components, clusterIdOf, DEFAULTS } from './cluster.js';
import { KINDS, buildArtifact, saveArtifact, saveState, loadState } from './emit.js';

export function evolve(root, projectId, clusterId, { kind, minConfidence, minClusterSize, minPrefixLength } = {}) {
  assertProjectId(projectId);
  if (!KINDS.includes(kind)) {
    throw fail('E_UNKNOWN_KIND', 'kind must be one of ' + KINDS.join(', ') + ', got ' + JSON.stringify(kind));
  }
  const existing = loadState(root, projectId, clusterId);
  if (existing && existing.state === 'evolved') {
    throw fail('E_ALREADY_EVOLVED', 'cluster ' + clusterId + ' already evolved into ' + existing.kind + ' at op ' + existing.at);
  }
  const mc = minConfidence === undefined ? DEFAULTS.minConfidence : minConfidence;
  const ms = minClusterSize === undefined ? DEFAULTS.minClusterSize : minClusterSize;
  const mp = minPrefixLength === undefined ? DEFAULTS.minPrefixLength : minPrefixLength;
  const instincts = list(root, projectId, { minConfidence: mc });
  let group = null;
  for (const g of components(instincts, mp)) {
    if (clusterIdOf(g.map((i) => i.id)) === clusterId) { group = g; break; }
  }
  if (!group) {
    throw fail('E_UNKNOWN_CLUSTER', 'no cluster ' + JSON.stringify(clusterId) + ' among current instincts of project ' + JSON.stringify(projectId));
  }
  if (group.length < ms) {
    throw fail('E_CLUSTER_BELOW_THRESHOLD', 'cluster ' + clusterId + ' has ' + group.length + ' members, minimum is ' + ms);
  }
  const instinctIds = group.map((i) => i.id).sort();
  const clusterRec = {
    clusterId,
    projectId,
    instinctIds,
    size: group.length,
    sharedPrefix: null,
    confidence: Math.round((group.reduce((n, i) => n + i.confidence, 0) / group.length) * 10000) / 10000,
  };
  // shared prefix for the artifact action (same rule as cluster.js)
  let prefix = group[0].action;
  for (const inst of group.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < inst.action.length && prefix[i] === inst.action[i]) i += 1;
    prefix = prefix.slice(0, i);
  }
  clusterRec.sharedPrefix = prefix.length >= mp ? prefix : null;
  const artifact = buildArtifact(clusterRec, [...group].sort((a, b) => (a.id < b.id ? -1 : 1)), kind, nextOp(root));
  saveArtifact(root, projectId, artifact);
  saveState(root, projectId, { clusterId, projectId, state: 'evolved', kind, at: artifact.generatedAt, instinctIds });
  return { artifact };
}

export function status(root, projectId, clusterId) {
  assertProjectId(projectId);
  const st = loadState(root, projectId, clusterId);
  if (st) return { state: st.state, kind: st.kind, at: st.at, instinctIds: st.instinctIds };
  const instincts = list(root, projectId, {});
  for (const g of components(instincts, DEFAULTS.minPrefixLength)) {
    if (clusterIdOf(g.map((i) => i.id)) === clusterId) {
      return { state: 'candidate', size: g.length, instinctIds: g.map((i) => i.id).sort() };
    }
  }
  throw fail('E_UNKNOWN_CLUSTER', 'no cluster ' + JSON.stringify(clusterId) + ' in project ' + JSON.stringify(projectId));
}

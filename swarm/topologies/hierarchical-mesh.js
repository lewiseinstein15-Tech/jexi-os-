/**
 * JEXI OS — Phase 20 Scope A — hierarchical-mesh topology.
 *
 * Layered meshes: members are chunked into clusters of 3 in input order
 * (last cluster may be smaller). Each cluster is internally a full mesh; the
 * first member of each cluster is its head, and the heads themselves form a
 * mesh at the top. Cross-cluster routing climbs to a head, crosses the head
 * mesh, and descends. Deterministic for a given member list.
 */
import { assertMembers, pair, router } from './_internal.js';

export const TYPE = 'hierarchical-mesh';

const CLUSTER_SIZE = 3;

function clustersOf(members) {
  const clusters = [];
  for (let i = 0; i < members.length; i += CLUSTER_SIZE) {
    clusters.push(members.slice(i, i + CLUSTER_SIZE));
  }
  return clusters;
}

export function build(members) {
  assertMembers(members);
  const clusters = clustersOf(members);
  const heads = clusters.map((c) => c[0]);
  const edges = [];
  for (const cluster of clusters) {
    for (let i = 0; i < cluster.length; i += 1) {
      for (let j = i + 1; j < cluster.length; j += 1) {
        edges.push(pair(cluster[i], cluster[j], 'cluster-mesh'));
      }
    }
  }
  for (let i = 0; i < heads.length; i += 1) {
    for (let j = i + 1; j < heads.length; j += 1) {
      edges.push(pair(heads[i], heads[j], 'head-mesh'));
    }
  }
  return { type: TYPE, members: [...members], edges, clusters: clusters.map((c) => [...c]), heads: [...heads], route: router(members, edges) };
}

export default { TYPE, build };

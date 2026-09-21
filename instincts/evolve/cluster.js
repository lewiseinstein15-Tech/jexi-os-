/**
 * JEXI OS — Phase 26 Scope D — clustering of related instincts.
 *
 * DECLARED CLUSTERING RULE (deterministic):
 *   Two instincts belong to the same cluster iff
 *     (a) their `action` strings share a common prefix of length
 *         >= minPrefixLength (default 8 characters), OR
 *     (b) their evidence signatures intersect by >= 1 element,
 *         where an evidence signature is the SORTED SET of
 *         sha256(evidence.text) over the instinct's evidence entries
 *         (entries without text are skipped).
 *   Clusters are the connected components (transitive closure) of
 *   that pairwise relation, computed over instincts with
 *   confidence >= minConfidence, processed in id-ascending order.
 *
 * clusterId = 'cluster-' + sha256(sorted instinctIds joined by \0).slice(0, 16)
 *   -> deterministic: the same member set always yields the same id.
 */
import crypto from 'node:crypto';
import { fail } from '../../semantica/_internal.js';
import { assertProjectId } from '../observe/scope.js';
import { list } from '../store/query.js';

export const DEFAULTS = { minConfidence: 0.5, minClusterSize: 3, minPrefixLength: 8 };

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

export function commonPrefixLength(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  return i;
}

export function evidenceSignature(instinct) {
  const sigs = [];
  for (const e of instinct.evidence || []) {
    const text = typeof e === 'string' ? e : e && e.text;
    if (typeof text === 'string' && text !== '') sigs.push(sha(text));
  }
  return [...new Set(sigs)].sort();
}

export function related(a, b, minPrefixLength) {
  if (commonPrefixLength(a.action, b.action) >= minPrefixLength) return true;
  const sa = new Set(evidenceSignature(a));
  for (const s of evidenceSignature(b)) if (sa.has(s)) return true;
  return false;
}

export function clusterIdOf(instinctIds) {
  const sorted = [...instinctIds].sort();
  return 'cluster-' + sha(sorted.join('\u0000')).slice(0, 16);
}

/** components over the given instincts (already filtered), id-asc order. */
export function components(instincts, minPrefixLength) {
  const sorted = [...instincts].sort((a, b) => (a.id < b.id ? -1 : 1));
  const parent = new Map(sorted.map((i) => [i.id, i.id]));
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const union = (x, y) => { const rx = find(x); const ry = find(y); if (rx !== ry) parent.set(ry, rx); };
  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      if (related(sorted[i], sorted[j], minPrefixLength)) union(sorted[i].id, sorted[j].id);
    }
  }
  const groups = new Map();
  for (const inst of sorted) {
    const root = find(inst.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(inst);
  }
  return [...groups.values()];
}

function longestCommonPrefix(actions) {
  if (actions.length === 0) return '';
  let prefix = actions[0];
  for (const a of actions.slice(1)) {
    prefix = a.slice(0, commonPrefixLength(prefix, a));
    if (prefix === '') break;
  }
  return prefix;
}

/**
 * cluster(root, projectId, { minConfidence?, minClusterSize?, minPrefixLength? })
 * -> clusters[] (only components with size >= minClusterSize), ordered by
 *    size desc then clusterId asc; each cluster is a structured record.
 */
export function cluster(root, projectId, opts = {}) {
  assertProjectId(projectId);
  const minConfidence = opts.minConfidence === undefined ? DEFAULTS.minConfidence : opts.minConfidence;
  const minClusterSize = opts.minClusterSize === undefined ? DEFAULTS.minClusterSize : opts.minClusterSize;
  const minPrefixLength = opts.minPrefixLength === undefined ? DEFAULTS.minPrefixLength : opts.minPrefixLength;
  for (const [k, v] of Object.entries({ minConfidence, minClusterSize, minPrefixLength })) {
    if (typeof v !== 'number' || !Number.isInteger(v) && k === 'minClusterSize' || (typeof v !== 'number') || v < 0) {
      throw fail('E_INVALID_CLUSTER_OPTS', k + ' must be a non-negative number');
    }
  }
  const instincts = list(root, projectId, { minConfidence });
  const out = [];
  for (const group of components(instincts, minPrefixLength)) {
    if (group.length < minClusterSize) continue;
    const instinctIds = group.map((i) => i.id).sort();
    const lcp = longestCommonPrefix(group.map((i) => i.action));
    out.push({
      clusterId: clusterIdOf(instinctIds),
      projectId,
      instinctIds,
      size: group.length,
      sharedPrefix: lcp.length >= minPrefixLength ? lcp : null,
      confidence: Math.round((group.reduce((n, i) => n + i.confidence, 0) / group.length) * 10000) / 10000,
      minConfidence,
      minClusterSize,
    });
  }
  return out.sort((a, b) => (b.size !== a.size ? b.size - a.size : (a.clusterId < b.clusterId ? -1 : 1)));
}

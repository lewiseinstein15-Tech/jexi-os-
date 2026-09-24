/**
 * JEXI OS — Phase 20 Scope A — topology registry.
 *
 *   topologies.build(type, members) -> { type, members, edges, route(from,to) }
 *   topologies.list()               -> all known types
 *   topologies.validate(topo)       -> { valid, errors? }
 *
 * build() never returns a fake structure: edges are the real coordination
 * links of the named topology, route() is a real BFS over exactly those
 * edges (null when unreachable), and the same members always produce the
 * same edges in the same order. Unknown type -> E_UNKNOWN_TOPOLOGY.
 */
import { SwarmError } from './_internal.js';
import adaptive from './adaptive.js';
import hierarchical from './hierarchical.js';
import hierarchicalMesh from './hierarchical-mesh.js';
import mesh from './mesh.js';
import ring from './ring.js';
import star from './star.js';

const BUILDERS = new Map([
  [adaptive.TYPE, adaptive],
  [hierarchical.TYPE, hierarchical],
  [hierarchicalMesh.TYPE, hierarchicalMesh],
  [mesh.TYPE, mesh],
  [ring.TYPE, ring],
  [star.TYPE, star],
]);

export function build(type, members) {
  const entry = BUILDERS.get(type);
  if (!entry) {
    throw new SwarmError('E_UNKNOWN_TOPOLOGY', `unknown topology "${String(type)}"; known: ${list().join(', ')}`);
  }
  return entry.build(members);
}

export function list() {
  return [...BUILDERS.keys()].sort();
}

/**
 * Structural + semantic validation. A topology is valid when its type is
 * known, its members are unique non-empty strings, its edges reference only
 * known members (no self-loops, no duplicates), and its edge set is exactly
 * what the named topology would build for those members — i.e. the record
 * was not hand-faked.
 */
export function validate(topo) {
  const errors = [];
  const push = (msg) => errors.push(msg);

  if (!topo || typeof topo !== 'object') {
    return { valid: false, errors: ['topology must be an object'] };
  }
  if (!BUILDERS.has(topo.type)) {
    push(`unknown topology type ${JSON.stringify(topo.type)}; known: ${list().join(', ')}`);
    return { valid: false, errors };
  }
  const members = topo.members;
  if (!Array.isArray(members) || members.length < 2) {
    push(`members must be an array of at least 2 ids, got ${JSON.stringify(members)}`);
    return { valid: false, errors };
  }
  const seen = new Set();
  for (const m of members) {
    if (typeof m !== 'string' || m.trim() === '') push(`member id must be a non-empty string, got ${JSON.stringify(m)}`);
    else if (seen.has(m)) push(`duplicate member "${m}"`);
    seen.add(m);
  }
  if (errors.length) return { valid: false, errors };

  if (!Array.isArray(topo.edges)) {
    push('edges must be an array');
  } else {
    const memberSet = new Set(members);
    const pairs = new Set();
    for (const e of topo.edges) {
      if (!e || typeof e !== 'object') { push('each edge must be an object'); continue; }
      if (!memberSet.has(e.from)) push(`edge references unknown member ${JSON.stringify(e.from)}`);
      if (!memberSet.has(e.to)) push(`edge references unknown member ${JSON.stringify(e.to)}`);
      if (e.from === e.to) push(`self-loop edge on "${e.from}"`);
      if (typeof e.role !== 'string' || e.role === '') push(`edge ${e.from}->${e.to} has no role`);
      const key = [e.from, e.to].sort().join('\u0000');
      if (pairs.has(key)) push(`duplicate edge between "${e.from}" and "${e.to}"`);
      pairs.add(key);
    }
  }
  if (typeof topo.route !== 'function') {
    push('route must be a function');
  }

  // Semantic check: the edges must be exactly what this topology builds.
  try {
    const rebuilt = BUILDERS.get(topo.type).build(members);
    const sameEdges = JSON.stringify(rebuilt.edges) === JSON.stringify(topo.edges);
    if (!sameEdges) push(`edges do not match what "${topo.type}" builds for these members (expected ${rebuilt.edges.length}, got ${topo.edges ? topo.edges.length : 0})`);
    if (topo.type === 'adaptive' && rebuilt.strategy !== topo.strategy) {
      push(`adaptive strategy mismatch: expected "${rebuilt.strategy}", got ${JSON.stringify(topo.strategy)}`);
    }
  } catch (err) {
    push(`rebuild failed: ${err.message}`);
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

export { SwarmError };
export { adaptive, hierarchical, hierarchicalMesh, mesh, ring, star };

export default { build, list, validate };

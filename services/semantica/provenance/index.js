/**
 * JEXI OS — Phase 14 Scope B — provenance entry point.
 *
 *   import { prov } from './semantica/provenance/index.js';
 *
 *   prov.attach(target, { agent, activity, source, when, parent? })
 *   prov.of(target)        -> guarded record | undefined
 *   prov.trace(target, { depth })
 *   prov.strictGraph()     -> Scope A graph whose addNode/addEdge
 *                             REFUSE entries without provenance
 *
 * ENFORCEMENT PATH (documented): Scope A nodes/edges are frozen and
 * Scope A files are not edited here. Enforcement is wired through
 * this module's own surface: prov.strictGraph() wraps graph.create()
 * and throws E_MISSING_PROVENANCE from addNode/addEdge before any
 * node/edge is created when no provenance spec is supplied. Plain
 * graph.create() stays permissive for callers that attach later.
 */
import { fail } from '../_internal.js';
import { graph } from '../graph/index.js';
import { makeAgent, makeActivity, makeEntity, PROV_TYPES } from './prov_o.js';
import { attach, of, has } from './record.js';
import { trace } from './trace.js';

function requireProv(spec, provSpec, what) {
  const p = provSpec ?? (spec && spec.provenance);
  if (!p || typeof p !== 'object') {
    throw fail('E_MISSING_PROVENANCE', `${what} needs provenance { agent, activity, source, when }; nothing enters the graph unprovenanced`);
  }
  return p;
}

/** A Scope A graph where every node/edge must carry provenance. */
export function strictGraph() {
  const g = graph.create();
  return {
    get inner() { return g; },
    get nodeCount() { return g.nodeCount; },
    get edgeCount() { return g.edgeCount; },
    addNode(spec = {}, provSpec) {
      const p = requireProv(spec, provSpec, 'addNode');
      const { provenance, ...nodeSpec } = spec;
      const node = g.addNode(nodeSpec);
      attach(node, p);
      return node;
    },
    addEdge(spec = {}, provSpec) {
      const p = requireProv(spec, provSpec, 'addEdge');
      const { provenance, ...edgeSpec } = spec;
      const edge = g.addEdge(edgeSpec);
      attach(edge, p);
      return edge;
    },
    getNode: (id) => g.getNode(id),
    getEdge: (from, to, kind) => g.getEdge(from, to, kind),
    nodes: () => g.nodes(),
    edges: () => g.edges(),
    query: (c) => g.query(c),
    traverse: (from, opts) => g.traverse(from, opts),
    serialize: () => g.serialize(),
  };
}

export const prov = {
  attach,
  of,
  trace,
  has,
  strictGraph,
  makeAgent,
  makeActivity,
  makeEntity,
  PROV_TYPES,
};

export { attach, of, trace, has, makeAgent, makeActivity, makeEntity, PROV_TYPES };
export { SemanticaError } from '../_internal.js';

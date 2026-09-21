/**
 * JEXI OS — PHASE 13 SCOPE D — IDENTITY GRAPH (facade).
 *
 *   import { createIdentityGraph } from './workforce/identity/index.js';
 *   const g = createIdentityGraph();
 *   g.create({ id: 'ui-designer', name: 'UI Designer' });
 *   g.resolve('UI Designer');        // -> { did, agentId }
 *   g.merge(a, b);                   // survivor = older DID by op-seq
 *   g.aliases(did);                  // every name the identity answers to
 *   g.graph();                       // { nodes, edges }
 *
 * Contract:
 *   identity.create(agent)          -> { did, agentId }
 *   identity.resolve(nameOrAlias)   -> { did, agentId }
 *   identity.merge(didA, didB)      -> { merged, survivor, absorbed, aliases }
 *   identity.aliases(did)           -> [strings]
 *   identity.graph()                -> { nodes, edges }
 *
 * Or the module-level default graph, bound to this repo's state dir:
 *
 *   import { create, resolve, merge, aliases, graph } from './workforce/identity/index.js';
 *
 * The default graph is lazy: the first query loads from disk (missing state =
 * empty graph), later calls reuse it. `reload()` re-reads.
 *
 * DIDs are `did:jexi:<agentId>` — deterministic, no clock, no random suffix.
 * See README.md.
 */

import { createIdentityGraph, ERRORS, IdentityError, STATE_DIR, SEQ_FILE, GRAPH_FILE, GRAPH_VERSION } from './graph.js';
import * as did from './did.js';
import * as resolveModule from './resolve.js';

let _default = null;

/** The lazily-created default graph, bound to this repo's state dir. */
export function defaultGraph() {
  if (!_default) _default = createIdentityGraph();
  return _default;
}

/** The default graph, loaded from disk on first use. */
export function identity() {
  const g = defaultGraph();
  if (!g.loaded) g.load();
  return g;
}

export function create(agent) { return identity().create(agent); }
export function resolve(nameOrAlias) { return identity().resolve(nameOrAlias); }
export function merge(didA, didB) { return identity().merge(didA, didB); }
export function aliases(did) { return identity().aliases(did); }
export function graph() { return identity().graph(); }
export function stats() { return identity().stats(); }
export function reload() { const g = identity(); return g.load(); }

export { createIdentityGraph, ERRORS, IdentityError, STATE_DIR, SEQ_FILE, GRAPH_FILE, GRAPH_VERSION };
export { did, resolveModule as resolveHelpers };
export { toDid, isDid, parseDid, agentIdFromDid, asDid, DID_PREFIX, METHOD, DID_ERRORS, DidError } from './did.js';
export { resolveName, resolveAll, duplicateNames, duplicateReport, seedFromRoster, mergePreview } from './resolve.js';
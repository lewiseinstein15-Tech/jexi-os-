/**
 * JEXI OS — Phase 14 Scope A — the context graph store.
 *
 *   graph.create()                          -> Graph
 *   g.addNode({ id, kind, label, props })   -> node
 *   g.addEdge({ from, to, kind, props })    -> edge
 *   g.getNode(id)                           -> node | undefined
 *   g.getEdge(from, to, kind)               -> edge | undefined
 *   g.query({ kind?, label?, prop? })       -> nodes[] (sorted by id)
 *   g.traverse(from, { depth, edgeKinds? }) -> nodes[] (sorted by id)
 *   g.serialize()                           -> deterministic JSON string
 *
 * No fake edges: traverse() walks exactly the stored adjacency, and
 * every read view (query/traverse/serialize) is ordered by id (edges
 * by from,to,kind), so the same input serializes to the same bytes.
 */
import { fail, byId } from '../_internal.js';
import { makeNode } from './nodes.js';
import { makeEdge, edgeKey, edgeSort } from './edges.js';
import { query as runQuery, traverse as runTraverse } from './query.js';

export class Graph {
  constructor() {
    /** id -> frozen node */
    this.nodesById = new Map();
    /** edgeKey(from,to,kind) -> frozen edge */
    this.edgesByKey = new Map();
    /** nodeId -> Set(edgeKey) for edges touching the node (either direction) */
    this.adjacency = new Map();
  }

  get nodeCount() { return this.nodesById.size; }
  get edgeCount() { return this.edgesByKey.size; }

  addNode(spec = {}) {
    if (this.nodesById.has(spec.id)) {
      throw fail('E_DUPLICATE_NODE', `node "${spec.id}" already exists in this graph`);
    }
    const node = makeNode(spec);
    this.nodesById.set(node.id, node);
    this.adjacency.set(node.id, new Set());
    return node;
  }

  addEdge(spec = {}) {
    for (const end of [spec.from, spec.to]) {
      if (!this.nodesById.has(end)) {
        throw fail('E_UNKNOWN_NODE', `edge endpoint "${end}" is not a node in this graph`);
      }
    }
    const edge = makeEdge(spec);
    const key = edgeKey(edge.from, edge.to, edge.kind);
    if (this.edgesByKey.has(key)) {
      throw fail('E_DUPLICATE_EDGE', `edge (${edge.from} -${edge.kind}-> ${edge.to}) already exists`);
    }
    this.edgesByKey.set(key, edge);
    this.adjacency.get(edge.from).add(key);
    this.adjacency.get(edge.to).add(key);
    return edge;
  }

  getNode(id) { return this.nodesById.get(id); }

  getEdge(from, to, kind) { return this.edgesByKey.get(edgeKey(from, to, kind)); }

  /** All nodes, sorted by id. */
  nodes() { return [...this.nodesById.values()].sort(byId); }

  /** All edges, sorted by (from, to, kind). */
  edges() { return [...this.edgesByKey.values()].sort(edgeSort); }

  /** Edge keys touching a node (either direction), sorted. */
  incident(id) {
    const set = this.adjacency.get(id);
    if (!set) throw fail('E_UNKNOWN_NODE', `node "${id}" is not in this graph`);
    return [...set].sort();
  }

  query(criteria = {}) { return runQuery(this, criteria); }

  traverse(from, opts = {}) { return runTraverse(this, from, opts); }

  /** Byte-stable serialization: fixed key order, id-sorted collections. */
  serialize() {
    return JSON.stringify({
      nodes: this.nodes().map((n) => ({ id: n.id, kind: n.kind, label: n.label, props: n.props })),
      edges: this.edges().map((e) => ({ from: e.from, to: e.to, kind: e.kind, props: e.props })),
    });
  }
}

export function create() { return new Graph(); }

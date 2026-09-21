/**
 * JEXI OS — Phase 14 Scope A — context graph edge model.
 *
 * An edge is a directed, typed link between two existing nodes:
 * { from, to, kind, props }. Edge identity is the (from, to, kind)
 * triple; the same triple twice is E_DUPLICATE_EDGE.
 */
import { fail, assertProps, assertNonEmptyString } from '../_internal.js';

const SEP = String.fromCharCode(0);

export function edgeKey(from, to, kind) {
  return [from, to, kind].join(SEP);
}

/** Build (but do not store) a frozen edge record. */
export function makeEdge({ from, to, kind, props } = {}) {
  assertNonEmptyString(from, 'edge from', 'E_INVALID_EDGE_ENDPOINT');
  assertNonEmptyString(to, 'edge to', 'E_INVALID_EDGE_ENDPOINT');
  assertNonEmptyString(kind, 'edge kind', 'E_INVALID_EDGE_KIND');
  const bag = assertProps(props, 'edge');
  return Object.freeze({
    from,
    to,
    kind,
    props: Object.freeze({ ...bag }),
  });
}

export const edgeSort = (a, b) => {
  const ka = edgeKey(a.from, a.to, a.kind);
  const kb = edgeKey(b.from, b.to, b.kind);
  return ka < kb ? -1 : ka > kb ? 1 : 0;
};

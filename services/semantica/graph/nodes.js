/**
 * JEXI OS — Phase 14 Scope A — context graph node constructors.
 *
 * Entities, relations, and decisions are FIRST-CLASS nodes. A node is
 * an immutable record { id, kind, label, props }; the kind is closed
 * (entity | relation | decision) and unknown kinds are refused with
 * E_UNKNOWN_NODE_KIND.
 */
import { fail, assertProps, assertNonEmptyString } from '../_internal.js';

export const NODE_KINDS = Object.freeze(['entity', 'relation', 'decision']);

export function assertNodeKind(kind) {
  if (!NODE_KINDS.includes(kind)) {
    throw fail('E_UNKNOWN_NODE_KIND', `unknown node kind ${JSON.stringify(kind)}; known: ${NODE_KINDS.join(', ')}`);
  }
  return kind;
}

/** Build (but do not store) a frozen node record. */
export function makeNode({ id, kind, label, props } = {}) {
  assertNonEmptyString(id, 'node id', 'E_INVALID_NODE_ID');
  assertNodeKind(kind);
  if (label !== undefined && typeof label !== 'string') {
    throw fail('E_INVALID_LABEL', `node label must be a string, got ${typeof label}`);
  }
  const bag = assertProps(props, 'node');
  return Object.freeze({
    id,
    kind,
    label: label ?? '',
    props: Object.freeze({ ...bag }),
  });
}

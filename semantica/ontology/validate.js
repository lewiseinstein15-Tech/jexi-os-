/**
 * JEXI OS — Phase 14 Scope D — validate a node/edge against the ontology.
 *
 *   validate(ontology, item, ctx?) -> { valid, errors? }
 *
 * item is a Scope A node ({ id, kind, ... }) or edge ({ from, to, kind }).
 * Shape decides which check runs: edges carry `from`/`to`.
 *
 * - node whose kind is not a declared class  -> throws E_UNDECLARED_KIND
 * - edge whose kind is not a declared relation -> throws E_UNDECLARED_RELATION
 * - declared but constraint-violating (missing requiredProps, or with a
 *   ctx endpoint-kind mismatch) -> { valid:false, errors:[...] }
 * - otherwise -> { valid:true }
 *
 * ctx (optional) = { kindOf: (id) => kind } lets relation `from`/`to`
 * class constraints be checked against real endpoints.
 */
import { fail } from '../_internal.js';

export function validate(ontology, item, ctx) {
  if (!item || typeof item !== 'object') {
    throw fail('E_INVALID_ITEM', 'validate needs a node or edge record');
  }
  const isEdge = item.from !== undefined && item.to !== undefined;
  if (isEdge) {
    const rel = ontology.relationOf(item.kind);
    if (!rel) {
      throw fail('E_UNDECLARED_RELATION', `relation "${item.kind}" is not declared in this ontology`);
    }
    const errors = [];
    const c = rel.constraints || {};
    if (ctx && typeof ctx.kindOf === 'function') {
      for (const [end, want] of [['from', c.from], ['to', c.to]]) {
        if (want !== undefined) {
          const got = ctx.kindOf(item[end]);
          if (got !== want) errors.push(`endpoint ${end} "${item[end]}" is kind "${got}", ontology requires "${want}"`);
        }
      }
    }
    return errors.length ? { valid: false, errors } : { valid: true };
  }
  const cls = ontology.classOf(item.kind);
  if (!cls) {
    throw fail('E_UNDECLARED_KIND', `node kind "${item.kind}" is not declared in this ontology`);
  }
  const errors = [];
  const c = cls.constraints || {};
  for (const prop of c.requiredProps || []) {
    if (item.props === undefined || item.props[prop] === undefined) {
      errors.push(`missing required prop "${prop}" for class "${item.kind}"`);
    }
  }
  return errors.length ? { valid: false, errors } : { valid: true };
}

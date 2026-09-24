/**
 * JEXI OS — Phase 14 Scope D — ontology declaration.
 *
 *   declare({ classes, relations }) -> { ontology }
 *   ontology.declare(more)          -> extend; conflicting redeclaration
 *                                      throws E_ONTOLOGY_CONFLICT
 *
 * A class = { name, constraints? } where constraints is a plain bag
 * (e.g. { requiredProps: ['owner'] }). A relation = { kind, constraints? }
 * (e.g. { from: 'entity', to: 'entity' }). Redeclaring an existing
 * name with IDENTICAL constraints is a no-op; with DIFFERENT
 * constraints it is an ontology conflict.
 */
import { fail, assertNonEmptyString } from '../_internal.js';

const stable = (v) => JSON.stringify(v, Object.keys(v || {}).sort());

export class Ontology {
  constructor() {
    this.classes = new Map();   // name -> frozen { name, constraints }
    this.relations = new Map(); // kind -> frozen { kind, constraints }
  }

  declare({ classes = [], relations = [] } = {}) {
    for (const c of classes) {
      assertNonEmptyString(c && c.name, 'class name', 'E_INVALID_CLASS');
      const constraints = c.constraints ?? {};
      if (this.classes.has(c.name)) {
        const existing = this.classes.get(c.name);
        if (stable(existing.constraints) !== stable(constraints)) {
          throw fail('E_ONTOLOGY_CONFLICT', `class "${c.name}" already declared with different constraints`);
        }
        continue;
      }
      this.classes.set(c.name, Object.freeze({ name: c.name, constraints: Object.freeze({ ...constraints }) }));
    }
    for (const r of relations) {
      assertNonEmptyString(r && r.kind, 'relation kind', 'E_INVALID_RELATION');
      const constraints = r.constraints ?? {};
      if (this.relations.has(r.kind)) {
        const existing = this.relations.get(r.kind);
        if (stable(existing.constraints) !== stable(constraints)) {
          throw fail('E_ONTOLOGY_CONFLICT', `relation "${r.kind}" already declared with different constraints`);
        }
        continue;
      }
      this.relations.set(r.kind, Object.freeze({ kind: r.kind, constraints: Object.freeze({ ...constraints }) }));
    }
    return this;
  }

  hasClass(name) { return this.classes.has(name); }
  hasRelation(kind) { return this.relations.has(kind); }
  classOf(name) { return this.classes.get(name); }
  relationOf(kind) { return this.relations.get(kind); }

  /** Deterministic declaration snapshot (sorted names). */
  toJSON() {
    return {
      classes: [...this.classes.values()].sort((a, b) => (a.name < b.name ? -1 : 1))
        .map((c) => ({ name: c.name, constraints: c.constraints })),
      relations: [...this.relations.values()].sort((a, b) => (a.kind < b.kind ? -1 : 1))
        .map((r) => ({ kind: r.kind, constraints: r.constraints })),
    };
  }
}

export function declare(spec = {}) {
  const ontology = new Ontology();
  ontology.declare(spec);
  return { ontology };
}

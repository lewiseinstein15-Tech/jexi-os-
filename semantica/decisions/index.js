/**
 * JEXI OS — Phase 14 Scope C — decision log entry point.
 *
 *   import { decisions } from './semantica/decisions/index.js';
 *   decisions.record({ subject, chosen, alternatives, rationale, by })
 *   decisions.get(id) / decisions.list({ subject? })
 *   decisions.intelligence(subject) / decisions.conflicts({ subject })
 *   decisions.create()  -> an independent log (for probes/tests)
 */
import { create, DecisionLog } from './log.js';
import { intelligence } from './intelligence.js';
import { conflicts } from './conflict.js';

const singleton = create();

export const decisions = {
  record: (spec) => singleton.record(spec),
  get: (id) => singleton.get(id),
  list: (crit) => singleton.list(crit),
  intelligence: (subject) => intelligence(singleton, subject),
  conflicts: (crit) => conflicts(singleton, crit),
  graph: () => singleton.graph(),
  create,
};

export { create, DecisionLog, intelligence, conflicts };
export { SemanticaError } from '../_internal.js';

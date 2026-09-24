// prompt/incidents/index.js
// Phase 25 — Scope H: public surface of the incident-driven negative
// few-shots subsystem.
//
// Contract spellings:
//   incidents.record(incident)         -> { id, recordedAt }
//     incident = { trigger, context, failure, fix } (all non-empty strings)
//   incidents.promote(incidentId)      -> { rule:{ when, do, because,
//                                           incidentId }, active, ruleId?,
//                                           reason?, errorCode? }
//   incidents.inject(sections, opts)   -> sections with rules injected
//     opts = { maxRulesPerSection = 5, section = 'doing-tasks' }
//
// Additive surface (same store, same guarantees):
//   incidents.get(id)            -> incident event | null
//   incidents.list()             -> all incident events (log order)
//   incidents.rules()            -> all rules with derived state
//                                   (active / supersededBy / revoked)
//   incidents.revoke(id, reason) -> { revoked, ruleId, at? } — an EVENT,
//                                   never a deletion (RULE 2)
//   incidents.injectionPlan(opts)-> { target, max, kept, dropped, block }
//   incidents.activeRules()      -> currently active rules
//
// Namespaces (for probes/tests; same layering style as the memory-fs facade):
//   log           — append-only NDJSON store (record / get / list / replay)
//   promote       — rule-based promotion + supersession + revocation
//   negativeShots — bounded, idempotent section injection
//
// Storage: .jexi/incidents/log.ndjson — REAL NDJSON on real disk, append-only
// (RULE 2), covered by the existing `.jexi/` gitignore rule (RULE 6).
// Override with env JEXI_INCIDENTS_ROOT for probes/tests (read at call time).
//
// Zone discipline: prompt/assembly, prompt/constitution, prompt/tools, and
// prompt/memory-fs are NOT modified by this scope. memory-fs is not even
// imported here — incidents are an independent subsystem; their only
// attachment point is the doing-tasks section at assembly time (Scope A
// registry, order 4, static), which is DISPLAY-ONLY in Scope H.

import * as log from './log.js';
import * as promote from './promote.js';
import * as negativeShots from './negative-shots.js';

export { log, promote, negativeShots };

export const INCIDENT_CODES = log.INCIDENT_CODES;
export const RULE_METHOD = log.RULE_METHOD;

export const incidents = {
  record: log.record,
  get: log.getIncident,
  list: log.listIncidents,
  promote: promote.promote,
  revoke: promote.revoke,
  rules: promote.listRules,
  inject: negativeShots.inject,
  injectionPlan: negativeShots.injectionPlan,
  activeRules: negativeShots.activeRules,
};

export default incidents;

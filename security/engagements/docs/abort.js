/**
 * JEXI OS — Phase 8 Scope D — DOCUMENT 4/8: ABORT CONDITIONS.
 *
 * Decepticon Soundwave: "Abort conditions: triggers, escalation."
 * A trigger is a condition plus the action to take when it fires; an
 * escalation is a level plus who owns it. Defaults cover the three
 * universal abort conditions (time, scope, severity).
 */

import { EngagementValidationError } from '../store.js';

export const DOC_ID = 'abort';
export const DOC_TITLE = 'Abort Conditions';

export const DEFAULT_TRIGGERS = [
  { condition: 'time window exceeded', action: 'halt all activity and notify the blue-team contact' },
  { condition: 'out-of-scope target contacted', action: 'halt immediately and record the violation in the audit log' },
  { condition: 'new finding exceeds roe maxSeverity', action: 'pause exploitation and escalate per the contact plan' },
];

export const DEFAULT_ESCALATION = [
  { level: 1, contact: 'engagement lead' },
  { level: 2, contact: 'blue-team coordinator' },
  { level: 3, contact: 'authorization owner' },
];

export function build(draft) {
  if (!draft || typeof draft !== 'object') {
    throw new EngagementValidationError('draft', `${DOC_ID}: expected a plan draft object`);
  }
  const triggers = (draft.abortTriggers && draft.abortTriggers.length) ? draft.abortTriggers : DEFAULT_TRIGGERS;
  const escalation = (draft.escalation && draft.escalation.length) ? draft.escalation : DEFAULT_ESCALATION;
  if (!Array.isArray(triggers)) {
    throw new EngagementValidationError('abortTriggers', `${DOC_ID}: abortTriggers must be an array`);
  }
  for (const t of triggers) {
    if (!t || typeof t.condition !== 'string' || !t.condition.trim() || typeof t.action !== 'string' || !t.action.trim()) {
      throw new EngagementValidationError('abortTriggers', `${DOC_ID}: every trigger needs condition and action — got ${JSON.stringify(t)}`);
    }
  }
  if (!Array.isArray(escalation) || escalation.some((e) => !e || !('level' in e) || !e.contact)) {
    throw new EngagementValidationError('escalation', `${DOC_ID}: every escalation entry needs level and contact`);
  }
  return {
    abort: {
      triggers: triggers.map((t) => ({ condition: t.condition, action: t.action })),
      escalation: escalation.map((e) => ({ level: e.level, contact: e.contact })),
    },
  };
}

export default { DOC_ID, DOC_TITLE, build };

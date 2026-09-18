/**
 * JEXI OS — Phase 8 Scope D — DOCUMENT 1/8: RULES OF ENGAGEMENT.
 *
 * Decepticon Soundwave: "Rules of Engagement: scope, allowed actions,
 * forbidden actions." Scope is part of the RoE document — the bundle keeps
 * it as its own `scope` section for direct machine consumption, but the
 * OPPLAN renders them together as one authorization contract.
 */

import { EngagementValidationError } from '../store.js';

export const DOC_ID = 'roe';
export const DOC_TITLE = 'Rules of Engagement (incl. scope)';

export function build(draft) {
  if (!draft || typeof draft !== 'object') {
    throw new EngagementValidationError('draft', `${DOC_ID}: expected a plan draft object`);
  }
  const arr = (v, field) => {
    if (!Array.isArray(v)) throw new EngagementValidationError(field, `${DOC_ID}: ${field} must be an array`);
    return v;
  };
  const severity = draft.maxSeverity;
  if (!['low', 'medium', 'high', 'critical'].includes(severity)) {
    throw new EngagementValidationError('maxSeverity', `${DOC_ID}: maxSeverity must be one of low|medium|high|critical — got ${JSON.stringify(severity)}`);
  }
  for (const w of arr(draft.timeWindows, 'timeWindows')) {
    if (!w || !w.start || !w.end || Number.isNaN(new Date(w.start).getTime()) || Number.isNaN(new Date(w.end).getTime())) {
      throw new EngagementValidationError('timeWindows', `${DOC_ID}: every time window needs parseable start and end — got ${JSON.stringify(w)}`);
    }
    if (new Date(w.start).getTime() > new Date(w.end).getTime()) {
      throw new EngagementValidationError('timeWindows', `${DOC_ID}: time window start after end — got ${JSON.stringify(w)}`);
    }
  }
  return {
    scope: {
      targets: arr(draft.targets, 'targets'),
      forbidden: arr(draft.forbidden, 'forbidden'),
      networks: arr(draft.networks, 'networks'),
    },
    roe: {
      allowedActions: arr(draft.allowedActions, 'allowedActions'),
      forbiddenActions: arr(draft.forbiddenActions, 'forbiddenActions'),
      requiresApproval: arr(draft.requiresApproval, 'requiresApproval'),
      timeWindows: draft.timeWindows.map((w) => ({ start: new Date(w.start).toISOString(), end: new Date(w.end).toISOString() })),
      maxSeverity: severity,
    },
  };
}

export default { DOC_ID, DOC_TITLE, build };

/**
 * JEXI OS — Phase 8 Scope D — DOCUMENT 7/8: CLEANUP.
 *
 * Decepticon Soundwave: "Cleanup: post-engagement removal." The declared
 * steps are executed by Engagements.runCleanup() — real filesystem
 * removal with receipts (paths, file counts, bytes), then verifiedAt is
 * stamped and persisted. Nothing here is a no-op promise: every removal
 * is accounted for.
 */

import { EngagementValidationError } from '../store.js';

export const DOC_ID = 'cleanup';
export const DOC_TITLE = 'Cleanup — post-engagement removal';

export const DEFAULT_STEPS = [
  'remove engagement artifacts and collected data from disk',
  'remove any test accounts or credentials provisioned during the engagement',
  'verify no residual changes persist on the target',
];

export function build(draft) {
  if (!draft || typeof draft !== 'object') {
    throw new EngagementValidationError('draft', `${DOC_ID}: expected a plan draft object`);
  }
  const steps = (draft.cleanupSteps && draft.cleanupSteps.length) ? draft.cleanupSteps : DEFAULT_STEPS;
  if (!Array.isArray(steps) || steps.some((s) => typeof s !== 'string' || !s.trim())) {
    throw new EngagementValidationError('cleanupSteps', `${DOC_ID}: cleanupSteps must be an array of non-empty strings`);
  }
  return { cleanup: { steps: steps.map((s) => s.trim()), verifiedAt: null } };
}

export default { DOC_ID, DOC_TITLE, build };

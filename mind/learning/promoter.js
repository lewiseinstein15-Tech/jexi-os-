/**
 * JEXI OS — Phase 7 Scope C: CONTINUOUS LEARNING — promoter.
 *
 * Promotes an instinct from project → global scope when it has genuinely
 * earned it (ECC continuous-learning-v2 criteria):
 *
 *   • confidence >= 0.8
 *   • seen in 3+ distinct project sessions
 *   • type is error_resolution or debugging_techniques
 *
 * The promotion is RECORDED, not just done:
 *   • global store gets a scope:'global' snapshot line
 *   • project store gets the promotion event line ({ kind: 'promotion' })
 *   • project store gets a promoted:true snapshot line (never re-promoted)
 *
 * Append-only throughout — no line is ever rewritten.
 */

import { projectStorePath, globalStorePath, foldStore, appendRecord, promotionEvent } from './store.js';
import { meetsPromotionCriteria } from './analyzer.js';

export const PROMOTION_DEFAULTS = Object.freeze({
  minConfidence: 0.8,
  minSessions: 3,
  types: ['error_resolution', 'debugging_techniques'],
});

/**
 * Promote every qualified project instinct to global.
 * @returns {{ promoted: instinct[], events: promotionEvent[], considered: number }}
 */
export function promoteQualified(repoRoot, { minConfidence = 0.8, minSessions = 3, types = PROMOTION_DEFAULTS.types, now = new Date().toISOString() } = {}) {
  const projectFile = projectStorePath(repoRoot);
  const globalFile = globalStorePath();
  const { instincts } = foldStore(projectFile);

  const candidates = [...instincts.values()].filter((i) => meetsPromotionCriteria(i, { minConfidence, minSessions, types }));
  const promoted = [];
  const events = [];

  for (const inst of candidates) {
    // 1. global snapshot — scope flips to global, always available in recall
    const globalSnapshot = {
      ...inst,
      scope: 'global',
      promotedAt: now,
      promotedFrom: 'project',
    };
    appendRecord(globalFile, globalSnapshot);

    // 2. project-side promotion event — the audit trail
    const event = promotionEvent(inst, {
      at: now,
      reason: `confidence ${inst.confidence} >= ${minConfidence}; ${inst.sessionIds?.length ?? 0} distinct sessions >= ${minSessions}; type ${inst.type}`,
    });
    appendRecord(projectFile, event);

    // 3. project-side promoted flag — last snapshot wins on fold, no re-promotion
    appendRecord(projectFile, { ...inst, promoted: true, promotedAt: now });

    promoted.push(globalSnapshot);
    events.push(event);
  }

  return { promoted, events, considered: instincts.size };
}

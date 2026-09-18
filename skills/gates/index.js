/**
 * JEXI OS — HARD GATES — registry.
 *
 * Canonical order: brainstorming → planning → tdd → review.
 * A gate that does not apply (when(ctx) false) never runs.
 */
import brainstormingGate from './brainstorming-gate.js';
import planningGate from './planning-gate.js';
import tddGate from './tdd-gate.js';
import reviewGate from './review-gate.js';

export const GATES = [brainstormingGate, planningGate, tddGate, reviewGate];

export { brainstormingGate, planningGate, tddGate, reviewGate };

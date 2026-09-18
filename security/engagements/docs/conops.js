/**
 * JEXI OS — Phase 8 Scope D — DOCUMENT 2/8: CONCEPT OF OPERATIONS.
 *
 * Decepticon Soundwave: "Concept of Operations: phases, sequencing."
 * Defaults to the Scope A pentest pipeline's five phases, sequential.
 */

import { EngagementValidationError } from '../store.js';

export const DOC_ID = 'conops';
export const DOC_TITLE = 'Concept of Operations';

export const DEFAULT_PHASES = [
  { name: 'pre-recon', order: 1, actions: ['static source analysis'] },
  { name: 'recon', order: 2, actions: ['live application crawl'] },
  { name: 'vulnerability', order: 3, actions: ['owasp agent probes'] },
  { name: 'exploitation', order: 4, actions: ['poc validation of findings'] },
  { name: 'reporting', order: 5, actions: ['deliverable generation'] },
];

export function build(draft) {
  if (!draft || typeof draft !== 'object') {
    throw new EngagementValidationError('draft', `${DOC_ID}: expected a plan draft object`);
  }
  const conops = draft.conops || {};
  const sequencing = conops.sequencing || 'sequential';
  if (!['sequential', 'parallel'].includes(sequencing)) {
    throw new EngagementValidationError('sequencing', `${DOC_ID}: sequencing must be sequential|parallel — got ${JSON.stringify(sequencing)}`);
  }
  const phases = conops.phases || DEFAULT_PHASES;
  if (!Array.isArray(phases) || !phases.length) {
    throw new EngagementValidationError('phases', `${DOC_ID}: phases must be a non-empty array`);
  }
  for (const p of phases) {
    if (!p || typeof p.name !== 'string' || !p.name.trim()) {
      throw new EngagementValidationError('phases', `${DOC_ID}: every phase needs a non-empty name — got ${JSON.stringify(p)}`);
    }
    if (!Number.isInteger(p.order)) {
      throw new EngagementValidationError('phases', `${DOC_ID}: phase "${p.name}" needs an integer order — got ${JSON.stringify(p.order)}`);
    }
    if (!Array.isArray(p.actions) || p.actions.some((a) => typeof a !== 'string')) {
      throw new EngagementValidationError('phases', `${DOC_ID}: phase "${p.name}" actions must be an array of strings`);
    }
  }
  return { conops: { phases: phases.map((p) => ({ name: p.name, order: p.order, actions: [...p.actions] })), sequencing } };
}

export default { DOC_ID, DOC_TITLE, build };

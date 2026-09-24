/**
 * JEXI OS — Phase 15 Scope D — capsules (packaged versioned change sets).
 *
 * A capsule is a packaged, NOT applied, gene change:
 *   { capsuleId, geneId, from, to, delta, status, fitness }
 * status lifecycle: packaged -> promoted -> rolled-back.
 */
import { fail } from '../../semantica/_internal.js';

export const CAPSULE_STATUS = ['packaged', 'promoted', 'rolled-back'];

export function makeCapsule({ capsuleId, geneId, from, to, delta }) {
  return { capsuleId, geneId, from, to, delta, status: 'packaged', fitness: null };
}

export function assertCapsule(capsule) {
  if (!capsule || typeof capsule !== 'object' || !CAPSULE_STATUS.includes(capsule.status)) {
    throw fail('E_INVALID_CAPSULE', 'malformed capsule record');
  }
  return capsule;
}

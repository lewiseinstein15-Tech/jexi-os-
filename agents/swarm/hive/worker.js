/**
 * JEXI OS — Phase 20 Scope B — worker records for the hive-mind.
 *
 * Eight worker types, ported from the ruflo hive pattern: builder,
 * verifier, researcher, planner, critic, retriever, synthesizer,
 * dispatcher. Each worker is a typed record; unknown types are refused.
 */
import { SwarmError } from '../topologies/_internal.js';

export const WORKER_TYPES = Object.freeze([
  'builder', 'verifier', 'researcher', 'planner',
  'critic', 'retriever', 'synthesizer', 'dispatcher',
]);

export function assertWorkerType(type) {
  if (!WORKER_TYPES.includes(type)) {
    throw new SwarmError('E_UNKNOWN_WORKER_TYPE', `unknown worker type "${String(type)}"; known: ${WORKER_TYPES.join(', ')}`);
  }
}

/** Create one worker record. */
export function createWorker({ type, id } = {}) {
  assertWorkerType(type);
  if (typeof id !== 'string' || id.trim() === '') {
    throw new SwarmError('E_INVALID_WORKER_ID', `worker id must be a non-empty string, got ${JSON.stringify(id)}`);
  }
  return Object.freeze({ id, type, role: 'worker' });
}

export default { WORKER_TYPES, createWorker, assertWorkerType };

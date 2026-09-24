/**
 * JEXI OS — Phase 20 Scope B — queen records for the hive-mind.
 *
 * Exactly one queen leads a hive. The queen type is chosen at create time
 * and fixes the leadership style; it is a real typed record, not a label.
 */
import { SwarmError } from '../topologies/_internal.js';

export const QUEEN_TYPES = Object.freeze(['strategist', 'executor', 'arbiter']);

export function assertQueenType(type) {
  if (!QUEEN_TYPES.includes(type)) {
    throw new SwarmError('E_UNKNOWN_QUEEN_TYPE', `unknown queen type "${String(type)}"; known: ${QUEEN_TYPES.join(', ')}`);
  }
}

/** Create the queen record. Id defaults deterministically to "queen". */
export function createQueen({ type, id = 'queen' } = {}) {
  assertQueenType(type);
  if (typeof id !== 'string' || id.trim() === '') {
    throw new SwarmError('E_INVALID_QUEEN_ID', `queen id must be a non-empty string, got ${JSON.stringify(id)}`);
  }
  return Object.freeze({ id, type, role: 'queen' });
}

export default { QUEEN_TYPES, createQueen, assertQueenType };

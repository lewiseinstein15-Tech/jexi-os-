import { failure } from './journal.js';
export const collection = 'memory';
export function validate(entry) {
  if (typeof entry.key !== 'string' || !entry.key.trim() || !Object.hasOwn(entry, 'value')) throw failure('E_ENTRY_SCHEMA', 'memory requires key and value');
  if (!Object.hasOwn(entry, 'provenance')) entry.provenance = 'unverified:phase-25-pending';
  if (typeof entry.provenance !== 'string') throw failure('E_ENTRY_SCHEMA', 'provenance placeholder must be a string');
  return entry;
}
export function bind(state) { return state.collection(collection); }

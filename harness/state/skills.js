import { failure } from './journal.js';
export const collection = 'skills';
export function validate(entry) {
  for (const field of ['name', 'description', 'whenToUse']) if (typeof entry[field] !== 'string' || !entry[field].trim()) throw failure('E_ENTRY_SCHEMA', `skills requires ${field}`);
  return entry;
}
export function bind(state) { return state.collection(collection); }

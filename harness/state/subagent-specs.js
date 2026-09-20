import { failure } from './journal.js';
export const collection = 'subagent-specs';
export function validate(entry) {
  for (const field of ['name', 'instructions']) if (typeof entry[field] !== 'string' || !entry[field].trim()) throw failure('E_ENTRY_SCHEMA', `subagent-specs requires ${field}`);
  return entry;
}
export function bind(state) { return state.collection(collection); }

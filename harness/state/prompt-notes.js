import { failure } from './journal.js';
export const collection = 'prompt-notes';
export function validate(entry) {
  if (typeof entry.text !== 'string' || !entry.text.trim()) throw failure('E_ENTRY_SCHEMA', 'prompt-notes requires text');
  return entry;
}
export function bind(state) { return state.collection(collection); }

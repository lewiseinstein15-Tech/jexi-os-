import { createHash } from 'node:crypto';
import { Journal, failure, jsonCopy, canonical } from './journal.js';
import { createBasePrompt } from '../immutable/base-prompt.js';
import * as prompts from './prompt-notes.js';
import * as skills from './skills.js';
import * as memory from './memory.js';
import * as subagents from './subagent-specs.js';
const schemas = new Map([prompts, skills, memory, subagents].map(m => [m.collection, m.validate]));
function object(value) {
  const copy = jsonCopy(value);
  if (!copy || Array.isArray(copy) || typeof copy !== 'object') throw failure('E_ENTRY_SCHEMA');
  return copy;
}
function replay(records) {
  const state = new Map([...schemas.keys()].map(k => [k, new Map()]));
  for (const r of records) {
    if (r.op === 'immutable-violation') continue;
    const entries = state.get(r.collection);
    if (!entries) throw failure('E_JOURNAL_CORRUPT');
    if (r.op === 'delete') {
      if (!entries.delete(r.id)) throw failure('E_JOURNAL_CORRUPT');
    } else {
      if ((r.op === 'create' && entries.has(r.id)) || (r.op === 'update' && !entries.has(r.id)) || r.entry?.id !== r.id) throw failure('E_JOURNAL_CORRUPT');
      schemas.get(r.collection)(r.entry);
      entries.set(r.id, r.entry);
    }
  }
  return state;
}
export class HarnessState {
  constructor(options = {}) {
    this.journal = new Journal(options);
    this.basePrompt = createBasePrompt({ journal: this.journal });
  }
  #check(collection) {
    if (collection === 'base-prompt' || (typeof collection === 'string' && /immutable|base-prompt/.test(collection))) this.basePrompt.refuse('state write/access');
    if (!schemas.has(collection)) throw failure('E_COLLECTION_UNKNOWN');
  }
  create(collection, entry) {
    this.#check(collection);
    const data = schemas.get(collection)(object(entry));
    return this.journal.transaction(records => {
      const entries = replay(records).get(collection);
      const id = data.id ?? createHash('sha256').update(canonical({ collection, entry: data, ordinal: records.filter(r => r.op === 'create' && r.collection === collection).length })).digest('hex').slice(0, 24);
      if (typeof id !== 'string' || !id.length) throw failure('E_ENTRY_ID');
      if (entries.has(id)) throw failure('E_ENTRY_EXISTS');
      const result = { ...data, id };
      return { record: { op: 'create', collection, id, entry: result }, result: jsonCopy(result) };
    });
  }
  read(collection, id) {
    this.#check(collection);
    const value = replay(this.journal.read()).get(collection).get(id);
    return value ? jsonCopy(value) : null;
  }
  list(collection) {
    this.#check(collection);
    return [...replay(this.journal.read()).get(collection).values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map(jsonCopy);
  }
  update(collection, id, patch) {
    this.#check(collection);
    const change = object(patch);
    if (Object.hasOwn(change, 'id') && change.id !== id) throw failure('E_ID_IMMUTABLE');
    return this.journal.transaction(records => {
      const current = replay(records).get(collection).get(id);
      if (!current) throw failure('E_ENTRY_NOT_FOUND');
      const result = schemas.get(collection)({ ...current, ...change, id });
      return { record: { op: 'update', collection, id, entry: result }, result: jsonCopy(result) };
    });
  }
  delete(collection, id) {
    this.#check(collection);
    return this.journal.transaction(records => {
      if (!replay(records).get(collection).has(id)) throw failure('E_ENTRY_NOT_FOUND');
      return { record: { op: 'delete', collection, id }, result: { removed: true } };
    });
  }
  collection(name) {
    this.#check(name);
    return Object.freeze({ create: entry => this.create(name, entry), read: id => this.read(name, id), update: (id, patch) => this.update(name, id, patch), delete: id => this.delete(name, id), list: () => this.list(name) });
  }
}
export function createState(options) { return new HarnessState(options); }
export default createState;

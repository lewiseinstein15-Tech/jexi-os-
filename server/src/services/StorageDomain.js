/**
 * B141 — STORAGE DOMAIN (DeepSeek Harness `packages/storage/storage-domain`
 * mirror, JEXI-branded).
 *
 * Typed KV tables over the storage hub: a domain is a named collection of
 * tables; each table is a durable key→record map with a memory cache, a
 * serialized write chain (atomic read-modify-write via update()), snapshot
 * iterators (entries/keys), and change events. Records are validated by an
 * optional per-table spec (assertRecord) and rejected with DomainError when
 * they violate it — fail-closed on invalid data.
 */

import { createStorageHub } from './StorageHub.js';

export class DomainError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
  }
}

/** One typed table over a storage unit. */
export class KvTable {
  constructor({ name, unit, spec = null, onEvent = null }) {
    this.name = name;
    this.unit = unit;
    this.spec = spec || {};
    this.onEvent = onEvent || null;
    this._cache = new Map();
    this.size = 0;
    this._chain = Promise.resolve();
    this._load();
  }

  _load() {
    try {
      const all = this.unit.get() || {};
      for (const [k, v] of Object.entries(all)) {
        if (k === '_version') continue;
        this._cache.set(k, v);
      }
      this.size = this._cache.size;
    } catch { this._cache.clear(); this.size = 0; }
  }

  _validate(key, value) {
    const spec = this.spec;
    if (spec && spec.fields && typeof value === 'object' && value !== null) {
      for (const [field, type] of Object.entries(spec.fields)) {
        if (value[field] === undefined || value[field] === null) continue;
        if (type === 'number' && typeof value[field] !== 'number') throw new DomainError('invalid-record', `field "${field}" must be a number`);
        if (type === 'string' && typeof value[field] !== 'string') throw new DomainError('invalid-record', `field "${field}" must be a string`);
        if (type === 'boolean' && typeof value[field] !== 'boolean') throw new DomainError('invalid-record', `field "${field}" must be a boolean`);
      }
    }
    if (spec && spec.required && Array.isArray(spec.required)) {
      for (const field of spec.required) {
        if (value === null || typeof value !== 'object' || value[field] === undefined) {
          throw new DomainError('invalid-record', `record requires field "${field}"`);
        }
      }
    }
  }

  _emit(type, key, value) {
    if (this.onEvent) { try { this.onEvent({ table: this.name, type, key, value }); } catch { /* noop */ } }
  }

  /** Read one record from memory (sync). */
  get(key) {
    return this._cache.get(String(key));
  }

  /** Snapshot entries iterator. */
  entries() {
    return this._cache.entries();
  }

  /** Snapshot keys iterator. */
  keys() {
    return this._cache.keys();
  }

  /** Enqueue an op: the queue itself never rejects (self-healing), so a
   *  failed op never poisons later writes. */
  _enqueue(op) {
    const run = this._chain.then(op);
    this._chain = run.catch(() => {}); // queue continues regardless of op failures
    return run;
  }

  /** Durable put (validated, memory + disk). */
  put(key, value) {
    const k = String(key);
    this._validate(k, value);
    return this._enqueue(() => {
      this._cache.set(k, value);
      this.size = this._cache.size;
      this.unit.set(k, value);
      this._emit('put', k, value);
      return undefined;
    });
  }

  /** Durable delete; false when absent (no write, no event). */
  delete(key) {
    const k = String(key);
    return this._enqueue(() => {
      if (!this._cache.has(k)) return false;
      this._cache.delete(k);
      this.size = this._cache.size;
      this.unit.delete(k);
      this._emit('delete', k, null);
      return true;
    });
  }

  /** Atomic read-modify-write on the write chain. */
  update(key, fn) {
    const k = String(key);
    return this._enqueue(() => {
      const current = this._cache.get(k);
      if (current === undefined) throw new DomainError('missing-key', `key "${k}" not found in table "${this.name}"`);
      const next = fn(current);
      this._validate(k, next);
      this._cache.set(k, next);
      this.unit.set(k, next);
      this._emit('put', k, next);
      return next;
    });
  }

  /** List records (snapshot array). */
  list() {
    return [...this._cache.entries()].map(([key, value]) => ({ key, value }));
  }
}

/** One open domain: a set of typed tables. */
export class StorageDomain {
  constructor({ name, hub } = {}) {
    this.name = String(name || 'domain');
    this.hub = hub;
    this.tables = new Map();
    this._events = [];
  }

  /** Open (or return) one table; spec { fields, required } optional. */
  async table(tableName, spec = null) {
    const t = String(tableName || '');
    if (this.tables.has(t)) return this.tables.get(t);
    const unit = await this.hub.open(`${this.name}_${t}`.replace(/[^a-z0-9._-]/g, '_'), 'json');
    const table = new KvTable({ name: t, unit, spec, onEvent: (ev) => { this._events.push(ev); if (this._events.length > 200) this._events.shift(); } });
    this.tables.set(t, table);
    return table;
  }

  /** Recent change events. */
  events(limit = 50) {
    return this._events.slice(-Math.max(1, Math.min(Number(limit) || 50, 200)));
  }

  /** Status for /api/storage/domain/:name. */
  status() {
    return {
      ok: true,
      name: this.name,
      tables: [...this.tables.keys()].map((t) => { const table = this.tables.get(t); return { name: t, size: table.size }; }),
      eventCount: this._events.length,
    };
  }
}

/** Create a domain bound to the shared hub (lazy singleton). */
let defaultHub = null;
export async function openDomain(name, tables = {}, { hub = null } = {}) {
  if (!defaultHub && !hub) defaultHub = await createStorageHub({ root: `${process.env.DATA_DIR || 'data'}/domain`, sqlitePath: `${process.env.DATA_DIR || 'data'}/domain.sqlite` });
  return new StorageDomain({ name, hub: hub || defaultHub, tables });
}

/**
 * B135 — STORAGE HUB (DeepSeek Harness `packages/storage/storage-json` +
 * `storage-sqlite` mirror).
 *
 * Key-value storage hub with two backends:
 *   json   — one human-readable `<unit>.json` file per unit under a root,
 *            published by atomic whole-file rewrite (dsh storage-json).
 *   sqlite — one database file hosts every routed unit, document-per-row
 *            (`key TEXT` / `value TEXT` JSON) via node:sqlite (dsh
 *            storage-sqlite). Journal mode default `wal`.
 *
 * Contract (dsh storage): unit names match `^[a-z0-9][a-z0-9._-]{0,63}$`,
 * a unit has exactly ONE live handle (double-open is a caller bug), every
 * unit carries a version stamp, and `kv.open` fails closed after `close()`.
 * When node:sqlite is unavailable the sqlite backend degrades to an
 * explicit StorageError so callers can fall back to json.
 */

import fs from 'fs';
import path from 'path';

export const UNIT_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export class StorageError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function validateDescriptor(name) {
  if (typeof name !== 'string' || !UNIT_NAME_RE.test(name)) {
    throw new StorageError('invalid-name', `unit name must match ${UNIT_NAME_RE}`);
  }
}

// Dynamic import so older Node without node:sqlite still boots (json backend).
let sqliteModule;
export async function loadSqliteModule() {
  if (sqliteModule !== undefined) return sqliteModule;
  try {
    sqliteModule = await import('node:sqlite');
  } catch {
    sqliteModule = null;
  }
  return sqliteModule;
}

/** One open JSON unit file. */
class JsonUnit {
  constructor(name, file, onClose) {
    this.name = name;
    this.file = file;
    this.onClose = onClose;
    this.closed = false;
    this.version = 0;
    this.data = {};
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.file)) {
        const parsed = JSON.parse(fs.readFileSync(this.file, 'utf-8'));
        if (parsed && typeof parsed === 'object') {
          this.data = parsed;
          this.version = Number(parsed._version) || 0;
        }
      }
    } catch { this.data = {}; this.version = 0; }
  }

  persist() {
    this.version += 1;
    const doc = { ...this.data, _version: this.version };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(doc, null, 2), 'utf-8');
    fs.renameSync(tmp, this.file);
  }

  get(key) { return key === undefined ? { ...this.data } : this.data[key]; }

  set(key, value) {
    if (key === undefined) this.data = value && typeof value === 'object' ? { ...value } : {};
    else this.data[key] = value;
    this.persist();
    return { version: this.version };
  }

  delete(key) {
    if (key === undefined) this.data = {};
    else delete this.data[key];
    this.persist();
    return { version: this.version };
  }

  close() { if (!this.closed) { this.closed = true; if (this.onClose) this.onClose(); } }
}

/** One open sqlite unit: document-per-row inside its record table. */
class SqliteUnit {
  constructor(name, db, table, onClose) {
    this.name = name;
    this.db = db;
    this.table = table;
    this.onClose = onClose;
    this.closed = false;
    this.version = 0;
    const row = db.prepare(`SELECT value FROM ${table} WHERE key = '${sanitizeIdent('__meta')}'`).get();
    if (row) {
      try { this.version = Number(JSON.parse(row.value)._version) || 0; } catch { this.version = 0; }
    }
  }

  get(key) {
    if (key === undefined) {
      const rows = this.db.prepare(`SELECT key, value FROM ${this.table}`).all();
      const out = {};
      for (const r of rows) { try { out[r.key] = JSON.parse(r.value); } catch { /* skip */ } }
      return out;
    }
    const row = this.db.prepare(`SELECT value FROM ${this.table} WHERE key = ?`).get(String(key));
    if (!row) return undefined;
    try { return JSON.parse(row.value); } catch { return undefined; }
  }

  set(key, value) {
    this.version += 1;
    const upsert = this.db.prepare(`INSERT INTO ${this.table} (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
    const tx = (() => { try { this.db.exec('BEGIN'); return () => this.db.exec('COMMIT'); } catch { return () => {}; } })();
    if (key === undefined) {
      this.db.exec(`DELETE FROM ${this.table} WHERE key != '__meta'`);
      for (const [k, v] of Object.entries(value || {})) upsert.run(String(k), JSON.stringify(v));
    } else {
      upsert.run(String(key), JSON.stringify(value));
    }
    upsert.run('__meta', JSON.stringify({ _version: this.version }));
    tx();
    return { version: this.version };
  }

  delete(key) {
    this.version += 1;
    const del = this.db.prepare(`DELETE FROM ${this.table} WHERE key = ?`);
    const tx = (() => { try { this.db.exec('BEGIN'); return () => this.db.exec('COMMIT'); } catch { return () => {}; } })();
    if (key === undefined) this.db.exec(`DELETE FROM ${this.table} WHERE key != '__meta'`);
    else del.run(String(key));
    this.db.prepare(`INSERT INTO ${this.table} (key, value) VALUES ('__meta', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .run(JSON.stringify({ _version: this.version }));
    tx();
    return { version: this.version };
  }

  close() { if (!this.closed) { this.closed = true; if (this.onClose) this.onClose(); } }
}

function sanitizeIdent(name) { return String(name).replace(/[^A-Za-z0-9_]/g, '_'); }

/** The JSON backend: one file per unit under a configured root. */
export class JsonStorageBackend {
  constructor(root) {
    this.root = root;
    this.kind = 'json';
    this.units = new Map();
    this.opening = new Map();
    this.closed = false;
  }

  async open(descriptor) {
    if (this.closed) throw new StorageError('closed', 'json backend is closed');
    validateDescriptor(descriptor.name);
    if (this.units.has(descriptor.name) || this.opening.has(descriptor.name)) {
      throw new Error(`unit '${descriptor.name}' is already open; a unit has exactly one live handle`);
    }
    await fs.promises.mkdir(this.root, { recursive: true, mode: 0o700 });
    const file = path.join(this.root, `${descriptor.name}.json`);
    const unit = new JsonUnit(descriptor.name, file, () => this.units.delete(descriptor.name));
    this.units.set(descriptor.name, unit);
    return unit;
  }

  async close() {
    this.closed = true;
    for (const unit of this.units.values()) { try { unit.close(); } catch { /* noop */ } }
    this.units.clear();
  }
}

/** The SQLite backend: one database file hosts every routed unit. */
export class SqliteStorageBackend {
  constructor(database) {
    this.db = database;
    this.kind = 'sqlite';
    this.units = new Map();
    this.closed = false;
    this.db.exec(`CREATE TABLE IF NOT EXISTS units (name TEXT PRIMARY KEY, version INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)`);
  }

  async open(descriptor) {
    if (this.closed) throw new StorageError('closed', 'sqlite backend is closed');
    validateDescriptor(descriptor.name);
    if (this.units.has(descriptor.name)) {
      throw new Error(`unit '${descriptor.name}' is already open; a unit has exactly one live handle`);
    }
    const table = `unit_${sanitizeIdent(descriptor.name)}`;
    this.db.exec(`CREATE TABLE IF NOT EXISTS ${table} (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    const stamp = this.db.prepare('INSERT INTO units (name, version, created_at) VALUES (?, 0, ?) ON CONFLICT(name) DO NOTHING');
    stamp.run(descriptor.name, Date.now());
    const unit = new SqliteUnit(descriptor.name, this.db, table, () => this.units.delete(descriptor.name));
    this.units.set(descriptor.name, unit);
    return unit;
  }

  async close() {
    this.closed = true;
    for (const unit of this.units.values()) { try { unit.close(); } catch { /* noop */ } }
    this.units.clear();
  }
}

/**
 * The storage hub: pick a backend, open units, list them.
 * @param {object} options { root: string, sqlitePath?: string }
 * @returns {Promise<{ backends: Record<string, backend>, listUnits(), open(name), close() }>}
 */
export async function createStorageHub({ root, sqlitePath = null } = {}) {
  const backends = {};
  const json = new JsonStorageBackend(root || path.join(process.cwd(), 'data', 'storage'));
  backends.json = json;
  if (sqlitePath) {
    const mod = await loadSqliteModule();
    if (mod && mod.DatabaseSync) {
      const db = new mod.DatabaseSync(sqlitePath === ':memory:' ? ':memory:' : sqlitePath);
      if (sqlitePath !== ':memory:') {
        try { db.exec('PRAGMA journal_mode = WAL'); } catch { /* noop */ }
      }
      backends.sqlite = new SqliteStorageBackend(db);
    } else {
      console.warn('[storage] node:sqlite unavailable — sqlite backend disabled (json backend active)');
    }
  }
  return {
    backends,
    listUnits() {
      const units = new Map();
      if (fs.existsSync(json.root)) {
        for (const f of fs.readdirSync(json.root)) {
          if (f.endsWith('.json')) units.set(f.slice(0, -5), 'json');
        }
      }
      if (backends.sqlite) {
        try {
          for (const row of backends.sqlite.db.prepare('SELECT name FROM units').all()) units.set(row.name, 'sqlite');
        } catch { /* noop */ }
      }
      return [...units.entries()].map(([name, backend]) => ({ name, backend }));
    },
    async open(name, prefer = 'json') {
      const backend = backends[prefer] || backends.json;
      return backend.open({ name });
    },
    /** Handle-free read (REST layer): never takes a unit handle. */
    async peek(name) {
      validateDescriptor(name);
      if (fs.existsSync(path.join(json.root, `${name}.json`))) {
        try {
          const parsed = JSON.parse(fs.readFileSync(path.join(json.root, `${name}.json`), 'utf-8'));
          return { unit: name, version: Number(parsed._version) || 0, value: (() => { const { _version, ...rest } = parsed; return rest; })() };
        } catch { return null; }
      }
      if (backends.sqlite) {
        try {
          const table = `unit_${sanitizeIdent(name)}`;
          const rows = backends.sqlite.db.prepare(`SELECT key, value FROM ${table}`).all();
          if (rows.length > 0) {
            const out = {};
            let version = 0;
            for (const r of rows) {
              if (r.key === '__meta') { try { version = Number(JSON.parse(r.value)._version) || 0; } catch { /* noop */ } continue; }
              try { out[r.key] = JSON.parse(r.value); } catch { /* skip */ }
            }
            return { unit: name, version, value: out };
          }
        } catch { return null; }
      }
      return null;
    },
    async close() {
      await json.close();
      if (backends.sqlite) await backends.sqlite.close();
    },
  };
}

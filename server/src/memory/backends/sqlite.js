/**
 * JEXI OS — MEMORY — SQLite backend (default, local, zero deps).
 *
 * One database file holds every tier, document-per-row (StorageHub /
 * SessionPersistenceSqlite convention). WAL journal. `node:sqlite`
 * via the shared loader so the server still boots on Node < 22.5
 * (the backend reports `available:false` and the JSON file fallback
 * path in index.js is used instead).
 *
 * Columns:
 *   key        TEXT PRIMARY KEY   — memory entry id
 *   mission_id TEXT NOT NULL      — isolation door
 *   tier       TEXT NOT NULL      — working|session|episodic|semantic
 *   value      TEXT NOT NULL      — JSON-serialized MemoryEntry
 *   content    TEXT               — searchable text (for lexical recall)
 *   sort_key   REAL               — createdAt, for ordering
 */

import { loadSqliteModule } from '../../services/StorageHub.js';

export const MEMORY_SCHEMA = `
  CREATE TABLE IF NOT EXISTS memory_entries (
    key        TEXT PRIMARY KEY,
    mission_id TEXT NOT NULL,
    tier       TEXT NOT NULL,
    value      TEXT NOT NULL,
    content    TEXT NOT NULL DEFAULT '',
    sort_key   REAL NOT NULL DEFAULT 0,
    expires_at REAL
  );
  CREATE INDEX IF NOT EXISTS idx_memory_mission ON memory_entries (mission_id, tier, sort_key);
  CREATE INDEX IF NOT EXISTS idx_memory_expiry  ON memory_entries (expires_at);
`;

export class SqliteMemoryBackend {
  constructor({ file = ':memory:' } = {}) {
    this.file = file;
    this.db = null;
    this._mod = null;
    this.available = false;
  }

  async open() {
    const mod = await loadSqliteModule();
    if (!mod || !mod.DatabaseSync) {
      this.available = false;
      return this;
    }
    this._mod = mod;
    this.db = new mod.DatabaseSync(this.file === ':memory:' ? ':memory:' : this.file);
    this.available = true;
    if (this.file !== ':memory:') {
      const { mkdirSync } = await import('node:fs');
      const { dirname } = await import('node:path');
      mkdirSync(dirname(this.file), { recursive: true });
      try { this.db.exec('PRAGMA journal_mode = WAL'); } catch { /* noop */ }
    }
    this.db.exec(MEMORY_SCHEMA);
    return this;
  }

  _stmt() {
    return this.db;
  }

  async insert(entry) {
    const value = JSON.stringify(entry);
    this._stmt().prepare(`INSERT OR REPLACE INTO memory_entries
      (key, mission_id, tier, value, content, sort_key, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(entry.id, entry.missionId, entry.tier, value, entry.content, entry.createdAt, entry.expiresAt ?? null);
    return entry;
  }

  async byKey(id) {
    const row = this._stmt().prepare(`SELECT value FROM memory_entries WHERE key = ?`).get(id);
    return row ? JSON.parse(row.value) : null;
  }

  async deleteByKey(id) {
    this._stmt().prepare(`DELETE FROM memory_entries WHERE key = ?`).run(id);
  }

  async recall({ missionId, tier = null, contentStem = '', limit = 50, excludeKey = null }) {
    let sql = `SELECT value FROM memory_entries WHERE mission_id = ?`;
    const params = [missionId];
    if (tier) {
      const tiers = Array.isArray(tier) ? tier : [tier];
      sql += ` AND tier IN (${tiers.map(() => '?').join(', ')})`;
      params.push(...tiers);
    }
    if (excludeKey) {
      sql += ` AND key != ?`;
      params.push(excludeKey);
    }
    if (contentStem) {
      sql += ` AND content LIKE ?`;
      params.push(`%${contentStem}%`);
    }
    sql += ` AND (expires_at IS NULL OR expires_at > ?) ORDER BY sort_key DESC LIMIT ?`;
    params.push(Date.now(), limit);
    const rows = this._stmt().prepare(sql).all(...params);
    return rows.map((r) => JSON.parse(r.value));
  }

  async recallAll({ missionId, tier = null, limit = 1000 } = {}) {
    let sql = `SELECT value FROM memory_entries WHERE mission_id = ?`;
    const params = [missionId];
    if (tier) {
      const tiers = Array.isArray(tier) ? tier : [tier];
      sql += ` AND tier IN (${tiers.map(() => '?').join(', ')})`;
      params.push(...tiers);
    }
    sql += ` ORDER BY sort_key DESC LIMIT ?`;
    params.push(limit);
    return this._stmt().prepare(sql).all(...params).map((r) => JSON.parse(r.value));
  }

  async count({ missionId = null, tier = null } = {}) {
    let sql = `SELECT COUNT(*) AS n FROM memory_entries`;
    const where = [];
    const params = [];
    if (missionId) { where.push('mission_id = ?'); params.push(missionId); }
    if (tier) { where.push('tier = ?'); params.push(tier); }
    if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
    return this._stmt().prepare(sql).get(...params).n;
  }

  /** Delete expired rows. Returns count removed. */
  async purgeExpired() {
    const r = this._stmt().prepare(`DELETE FROM memory_entries WHERE expires_at IS NOT NULL AND expires_at <= ?`).run(Date.now());
    return r.changes ?? 0;
  }

  async close() {
    try { this.db?.close(); } catch { /* noop */ }
    this.db = null;
  }

  /** Wipe everything this backend owns (test isolation, reset). */
  async wipe() {
    this._stmt().prepare(`DELETE FROM memory_entries`).run();
  }
}

/** Default opened backend: `:memory:` unless a file is given. */
export async function openSqliteMemoryBackend({ file = ':memory:' } = {}) {
  const backend = new SqliteMemoryBackend({ file });
  await backend.open();
  return backend;
}
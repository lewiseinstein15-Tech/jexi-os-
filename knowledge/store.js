/**
 * JEXI OS — Phase 8 Scope C — KNOWLEDGE GRAPH STORE (SQLite persistence).
 *
 * Decepticon pattern, JEXI storage family: findings persist to the graph,
 * not agent memory, and the graph survives process death. One SQLite file
 * via node:sqlite — the same zero-dependency pattern as Phase 4 memory
 * (server/src/memory/backends/sqlite.js) and StorageHub. WAL journal,
 * foreign keys ON, migrations applied idempotently.
 *
 *   const store = openStore({ dbPath: '/abs/path/graph.db' });
 *   store.db           — raw DatabaseSync handle (probes may SELECT directly)
 *   store.migrate()    — applied automatically on open
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(MODULE_DIR, 'schema', 'migrations');

export function openStore({ dbPath } = {}) {
  if (!dbPath || typeof dbPath !== 'string') {
    throw new Error('openStore: dbPath is required (explicit — no silent defaults)');
  }
  fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  const db = new DatabaseSync(path.resolve(dbPath));
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  migrate(db);
  return {
    db,
    dbPath: path.resolve(dbPath),
    close: () => { try { db.close(); } catch { /* already closed */ } },
  };
}

/** Apply every migration/*.sql newer than what the schema table knows. Idempotent. */
export function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _knowledge_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
  const applied = new Set(
    db.prepare('SELECT name FROM _knowledge_migrations').all().map((r) => r.name),
  );
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    // strip comment lines FIRST (comments may contain ';'), then split statements
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) {
      db.exec(stmt + ';');
    }
    db.prepare('INSERT INTO _knowledge_migrations (name, applied_at) VALUES (?, ?)')
      .run(file, new Date().toISOString());
  }
}

/** Deterministic natural keys — idempotency across re-runs and resume(). */
export function naturalKey(...parts) {
  return parts.map((p) => (p === null || p === undefined ? '' : String(p))).join('|');
}

/** FNV-1a 32-bit, hex — short deterministic digests for derived natural keys. */
export function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export const nowIso = () => new Date().toISOString();

/** Specific, field-level rejection for contract violations (probe P9). */
export class GraphValidationError extends Error {
  constructor(entity, field, message) {
    super(`${entity} validation failed: ${message}`);
    this.name = 'GraphValidationError';
    this.code = 'E_GRAPH_VALIDATION';
    this.entity = entity;
    this.field = field;
  }
}

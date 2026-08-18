/**
 * B135 — SESSION PERSISTENCE · SQLITE (DeepSeek Harness
 * `packages/session/session-persistence-sqlite` mirror).
 *
 * SQLite durable session-persistence backend: each session header and event
 * maps to rows in one database file (document-per-row, WAL journal). It sits
 * BESIDE the append-only jsonl logs (SessionConversations) as a second
 * durable mirror and revision source. Torn-tail protection: a startup scan
 * deletes events whose seq is not contiguous with the session's revision.
 *
 * Wired via an observer on appendConversationEvent so EVERY writer (chat,
 * plan mode, sandbox events, lifecycle) is mirrored without touching call
 * sites. When node:sqlite is unavailable (Node < 22.5) the backend reports
 * `available: false` and stays a no-op — jsonl remains the source of truth.
 */

import fs from 'fs';
import path from 'path';
import { loadSqliteModule } from './StorageHub.js';

let db = null;
let available = false;
let dbPath = null;
let writeQueue = []; // batched inserts (dsh write-batch coalescing)
let flushTimer = null;
const BATCH_DELAY_MS = 150;

/** Open (or create) the session database at `file` (':memory:' allowed). */
export async function openSessionPersistence(file) {
  const mod = await loadSqliteModule();
  if (!mod || !mod.DatabaseSync) {
    console.warn('[session-persistence-sqlite] node:sqlite unavailable — sqlite session mirror disabled');
    available = false;
    return { available: false };
  }
  dbPath = file;
  try {
    db = new mod.DatabaseSync(file === ':memory:' ? ':memory:' : file);
    if (file !== ':memory:') {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      try { db.exec('PRAGMA journal_mode = WAL'); } catch { /* noop */ }
    }
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        header TEXT NOT NULL,
        incarnation TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS session_events (
        session_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        role TEXT,
        kind TEXT,
        text TEXT,
        meta TEXT,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (session_id, seq)
      );
      CREATE INDEX IF NOT EXISTS idx_events_session ON session_events (session_id, seq);
    `);
    available = true;
    healTornTail();
    return { available: true, path: file };
  } catch (e) {
    console.error('[session-persistence-sqlite] open failed:', e.message);
    available = false;
    return { available: false, error: e.message };
  }
}

/** Revision (last seq + incarnation) for one session. */
export function sessionRevision(convId) {
  if (!available || !db) return null;
  try {
    const row = db.prepare('SELECT revision, incarnation FROM sessions WHERE id = ?').get(String(convId));
    return row ? { revision: row.revision, incarnation: row.incarnation } : { revision: -1, incarnation: null };
  } catch { return null; }
}

/** Mirror one conversation event into sqlite (batched, non-blocking). */
export function persistSessionEvent(convId, event) {
  if (!available || !db || !convId || !event) return;
  writeQueue.push({ convId: String(convId), event });
  if (!flushTimer) {
    flushTimer = setTimeout(flushWrites, BATCH_DELAY_MS);
    if (flushTimer.unref) flushTimer.unref();
  }
}

function flushWrites() {
  flushTimer = null;
  if (!available || !db || writeQueue.length === 0) return;
  const batch = writeQueue;
  writeQueue = [];
  try {
    db.exec('BEGIN');
    const upsertSession = db.prepare(`
      INSERT INTO sessions (id, header, incarnation, revision, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, updated_at = excluded.updated_at
    `);
    const insertEvent = db.prepare(`
      INSERT OR IGNORE INTO session_events (session_id, seq, role, kind, text, meta, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const { convId, event } of batch) {
      const revision = sessionRevision(convId) || { revision: -1, incarnation: null };
      insertEvent.run(convId, Number(event.seq) || 0, event.role || null, event.kind || 'chat', event.text || null, event.meta ? JSON.stringify(event.meta) : null, Number(event.at) || Date.now());
      upsertSession.run(convId, JSON.stringify({ title: null }), revision.incarnation || `inc-${Date.now()}`, Math.max(Number(event.seq) || 0, revision.revision), Date.now());
    }
    db.exec('COMMIT');
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* noop */ }
    console.warn('[session-persistence-sqlite] flush error:', e.message);
  }
}

/** Delete events beyond the last contiguous seq (torn tail from a crash). */
function healTornTail() {
  try {
    const sessions = db.prepare('SELECT id, revision FROM sessions').all();
    for (const s of sessions) {
      const row = db.prepare('SELECT MAX(seq) AS max_seq FROM session_events WHERE session_id = ?').get(s.id);
      if (row && Number(row.max_seq) > Number(s.revision)) {
        db.prepare('DELETE FROM session_events WHERE session_id = ? AND seq > ?').run(s.id, Number(s.revision));
      }
    }
  } catch { /* noop */ }
}

/** Status for diagnostics. */
export function sessionPersistenceStatus() {
  if (!available || !db) return { available: false, backend: 'jsonl-only' };
  try {
    const sessions = db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n;
    const events = db.prepare('SELECT COUNT(*) AS n FROM session_events').get().n;
    return { available: true, backend: 'sqlite', path: dbPath, sessions, events, journal: (() => { try { return db.prepare('PRAGMA journal_mode').get().journal_mode; } catch { return 'unknown'; } })() };
  } catch (e) {
    return { available: true, backend: 'sqlite', error: e.message };
  }
}

/** Close the database (flush pending first). */
export async function closeSessionPersistence() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  flushWrites();
  if (db) { try { db.close(); } catch { /* noop */ } }
  db = null;
  available = false;
}

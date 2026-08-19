/**
 * B144 — SESSION QUERY (DeepSeek Harness `packages/session-query/session-query`
 * + `session-log-export` + `session-query-sqlite` + `tool-session-query`
 * mirror, JEXI-branded).
 *
 * Query surfaces over the session store:
 *   querySessionLog(convId, filter)   — filter a conversation's event log
 *     (kind/role/limit/after-seq) and return { events, count, exportedAt }.
 *   exportSessionLog(convId)          — JSONL export of the raw log (the
 *     /api/conversations/:id/export backend, dsh session-log-export).
 *   querySessionSqlite(convId, filter)— query the durable sqlite mirror
 *     when available (dsh session-query-sqlite).
 *   searchSessions(query)             — full-text-ish search over titles +
 *     bodies (dsh tool-session-query is the model-facing `session-search`).
 */

import fs from 'fs';
import { conversationFilePath, loadConversationEvents, searchConversations } from './SessionConversations.js';
import { sessionPersistenceStatus, getSessionPersistenceDb } from './SessionPersistenceSqlite.js';

/** Filter one conversation's event log (newest-last, bounded). */
export function querySessionLog(convId, { kind = null, role = null, limit = 200, afterSeq = null } = {}) {
  const id = String(convId || '');
  if (!id) return { ok: false, error: 'convId required' };
  let events = loadConversationEvents(id, 2000);
  if (kind) events = events.filter((e) => e.kind === String(kind));
  if (role) events = events.filter((e) => e.role === String(role));
  if (Number.isInteger(afterSeq)) events = events.filter((e) => e.seq > afterSeq);
  const sliced = events.slice(-Math.max(1, Math.min(Number(limit) || 200, 2000)));
  return {
    ok: true,
    convId: id,
    count: sliced.length,
    total: events.length,
    exportedAt: Date.now(),
    events: sliced,
  };
}

/** JSONL export of one conversation's raw log. */
export function exportSessionLog(convId) {
  const id = String(convId || '');
  if (!id) return { ok: false, error: 'convId required' };
  try {
    const file = conversationFilePath(id);
    const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '';
    return { ok: true, convId: id, format: 'jsonl', lines: text.split('\n').filter(Boolean).length, bytes: Buffer.byteLength(text, 'utf8'), content: text };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

/** Query the durable sqlite session mirror (when available). */
export function querySessionSqlite(convId, { kind = null, limit = 100 } = {}) {
  const id = String(convId || '');
  if (!id) return { ok: false, error: 'convId required' };
  try {
    const st = sessionPersistenceStatus();
    if (!st.available) return { ok: false, error: 'sqlite session mirror is not available (jsonl remains the source of truth)' };
    const db = getSessionPersistenceDb();
    if (!db) return { ok: false, error: 'sqlite mirror not open' };
    const rows = db.prepare('SELECT seq, role, kind, text, meta, created_at FROM session_events WHERE session_id = ? AND (? IS NULL OR kind = ?) ORDER BY seq DESC LIMIT ?')
      .all(id, kind || null, kind || null, Math.min(Number(limit) || 100, 1000));
    return { ok: true, backend: 'sqlite', count: rows.length, events: rows };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

/** Search across conversations (titles + bodies; dsh tool-session-query). */
export function searchSessions(query, { limit = 5 } = {}) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return { ok: false, error: 'query required' };
  try {
    return { ok: true, query: q, results: searchConversations(q, { limit }) };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

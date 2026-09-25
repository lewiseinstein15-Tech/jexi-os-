/**
 * ui-rebuild-premium-v2 BUG 3 — chat session registry + transcript snapshots.
 *
 * localStorage-backed (there is NO /api/sessions list endpoint on the server
 * today — checked; wiring one was explicitly out of scope without declaring
 * it, so this is localStorage-only by design). Three stores:
 *
 *   jx-chat-sessions            -> [{ id, title, ts }] newest-first, max 30
 *   jx-chat-transcript-<id>     -> row snapshot for restore (cap ~160 KB,
 *                                  oldest rows dropped first)
 *
 * The registry ONLY records a session once the user actually sends a message
 * (touchSession with the first user text) — "+ New chat" does NOT create
 * empty entries. Every mutation dispatches `jx-sessions-change` so the shell
 * re-renders the history list without prop drilling.
 *
 * Honesty rules: localStorage failures degrade to a no-op (the chat still
 * works, history just does not persist); nothing is faked.
 */

const LIST_KEY = 'jx-chat-sessions';
const ROWS_PREFIX = 'jx-chat-transcript-';
const MAX_SESSIONS = 30;
const MAX_SNAPSHOT_BYTES = 160 * 1024;

function safeGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeSet(key, value) {
  try { localStorage.setItem(key, value); return true; } catch { return false; }
}
function safeRemove(key) {
  try { localStorage.removeItem(key); } catch { /* storage unavailable */ }
}

function emitChange() {
  try { window.dispatchEvent(new CustomEvent('jx-sessions-change')); } catch { /* non-DOM context */ }
}

/** Full session list, newest first. */
export function listSessions() {
  try {
    const raw = safeGet(LIST_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((s) => s && typeof s.id === 'string' && s.id)
      .sort((a, b) => (b.ts || 0) - (a.ts || 0))
      .slice(0, MAX_SESSIONS);
  } catch { return []; }
}

/** A fresh session id — NOT registered until the first message lands. */
export function newSessionId() {
  const rnd = Math.random().toString(36).slice(2, 8);
  return `chat-${Date.now().toString(36)}-${rnd}`;
}

/** Upsert a session; titleText becomes the (truncated) title when absent. */
export function touchSession(id, titleText) {
  if (!id) return;
  const list = listSessions();
  const found = list.find((s) => s.id === id);
  const title = typeof titleText === 'string' && titleText.trim()
    ? titleText.trim().replace(/\s+/g, ' ').slice(0, 64)
    : null;
  if (found) {
    found.ts = Date.now();
    if (title && (!found.title || found.title === 'untitled')) found.title = title;
  } else {
    list.unshift({ id, title: title || 'untitled', ts: Date.now() });
  }
  const trimmed = list.sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, MAX_SESSIONS);
  // Sessions that fall off the list lose their snapshots too (bounded storage).
  const kept = new Set(trimmed.map((s) => s.id));
  for (const s of list.slice(MAX_SESSIONS)) safeRemove(ROWS_PREFIX + s.id);
  if (safeSet(LIST_KEY, JSON.stringify(trimmed))) emitChange();
  void kept;
}

export function removeSession(id) {
  if (!id) return;
  const list = listSessions().filter((s) => s.id !== id);
  safeRemove(ROWS_PREFIX + id);
  if (safeSet(LIST_KEY, JSON.stringify(list))) emitChange();
}

/** Persist the transcript rows of one session (bounded, drop-oldest). */
export function snapshotTranscript(id, rows) {
  if (!id || !Array.isArray(rows) || rows.length === 0) return;
  let payload = rows.slice(-400); // cap row count first
  const pack = (list) => JSON.stringify(list);
  let body = pack(payload);
  // Over budget -> drop oldest rows until it fits (keep at least the last 20).
  while (body.length > MAX_SNAPSHOT_BYTES && payload.length > 20) {
    payload = payload.slice(Math.floor(payload.length / 4));
    body = pack(payload);
  }
  if (body.length > MAX_SNAPSHOT_BYTES) return; // still too big — skip, never break the chat
  safeSet(ROWS_PREFIX + id, body);
}

/** Restore the transcript rows of one session (or null). */
export function loadTranscript(id) {
  if (!id) return null;
  try {
    const raw = safeGet(ROWS_PREFIX + id);
    if (!raw) return null;
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return null;
    // Renumber seqs far-negative so they can never collide with the live
    // router seqs (positive) or the local /gui rows (-1, -2, …) after a page
    // reload restarts the router counter.
    return arr.map((r, i) => ({ ...(r || {}), seq: -(1000000 + i) }));
  } catch { return null; }
}

/** "2m ago" / "3h ago" / "yesterday" / "5d ago" — for the history list. */
export function relativeTime(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return '';
  const diff = Date.now() - n;
  if (diff < 45 * 1000) return 'just now';
  const min = Math.round(diff / 60000);
  if (min < 60) return `${Math.max(1, min)}m ago`;
  const h = Math.round(diff / 3600000);
  if (h < 24) return `${h}h ago`;
  const day = Math.round(diff / 86400000);
  if (day === 1) return 'yesterday';
  return `${day}d ago`;
}

export const _keys = { LIST_KEY, ROWS_PREFIX };

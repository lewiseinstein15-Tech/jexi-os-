/**
 * B160 — REFERENCE SOURCE (DeepSeek Harness
 * `packages/client/ui-reference` mirror).
 *
 * Unified Web @file and @session reference source: one provider list, one
 * ranking pass, one query API used by the composer's @-autocomplete.
 *
 *   resolveReferenceSource({ query, kind, limit })
 *     → [{ kind: 'file'|'session', id, label, detail, insert }]
 *
 * Providers are pluggable (DSH: provider registry); the default two ride
 * JEXI's existing open endpoints:
 *   - files    → /api/workspace (the built deliverables workspace)
 *   - sessions → /api/conversations (chat history)
 * Local subsequence fuzzy matching mirrors the server's bounded index so
 * ranking stays instant while typing.
 */

import { getBackendUrl, jexiFetch } from './helpers';

const CACHE_TTL_MS = 15000;
const cache = { files: { at: 0, items: [] }, sessions: { at: 0, items: [] } };

/** Subsequence fuzzy score — same shape as the server's FileReference. */
export function fuzzyScore(candidate, query) {
  const c = String(candidate || '').toLowerCase();
  const q = String(query || '').toLowerCase();
  if (!q) return 1;
  if (c === q) return 1000;
  if (c.startsWith(q) || c.includes(q)) return 700 - c.length * 0.25;
  let qi = 0, score = 0, streak = 0;
  for (let ci = 0; ci < c.length && qi < q.length; ci++) {
    if (c[ci] === q[qi]) {
      streak += 1;
      score += 10 + streak * 2;
      if (ci === 0 || '/._- '.includes(c[ci - 1])) score += 12;
      qi += 1;
    } else streak = 0;
  }
  return qi < q.length ? 0 : score - c.length * 0.5;
}

async function fetchFiles() {
  const now = Date.now();
  if (now - cache.files.at < CACHE_TTL_MS) return cache.files.items;
  try {
    const res = await jexiFetch(`${getBackendUrl()}/api/workspace`, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      const files = Array.isArray(data.files) ? data.files : [];
      cache.files.items = files.slice(0, 500).map((f) => ({
        kind: 'file',
        id: typeof f === 'string' ? f : (f.name || f.path || String(f)),
        label: typeof f === 'string' ? f : (f.name || f.path || String(f)),
        detail: 'file',
      }));
      cache.files.at = now;
    }
  } catch { /* offline → cached items */ }
  return cache.files.items;
}

async function fetchSessions() {
  const now = Date.now();
  if (now - cache.sessions.at < CACHE_TTL_MS) return cache.sessions.items;
  try {
    const res = await jexiFetch(`${getBackendUrl()}/api/conversations`, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      const list = Array.isArray(data.conversations) ? data.conversations : (Array.isArray(data) ? data : []);
      cache.sessions.items = list.slice(0, 200).map((c) => ({
        kind: 'session',
        id: c.id || c.conversationId || String(c),
        label: c.title || c.preview || (c.id || 'conversation'),
        detail: c.updatedAt || c.date || 'past conversation',
      }));
      cache.sessions.at = now;
    }
  } catch { /* offline → cached items */ }
  return cache.sessions.items;
}

/**
 * The unified query: rank files + sessions against a partial @token.
 * `kind` restricts ('file' | 'session'); default both.
 */
export async function resolveReferenceSource({ query = '', kind = null, limit = 6 } = {}) {
  const q = String(query).replace(/^[@[]/, '');
  const wantFiles = !kind || kind === 'file';
  const wantSessions = !kind || kind === 'session';
  const [files, sessions] = await Promise.all([
    wantFiles ? fetchFiles() : Promise.resolve([]),
    wantSessions ? fetchSessions() : Promise.resolve([]),
  ]);
  const scored = [];
  for (const item of files) {
    const s = fuzzyScore(item.label, q);
    if (s > 0) scored.push({ ...item, score: s, insert: `@${item.id}` });
  }
  for (const item of sessions) {
    const s = fuzzyScore(item.label, q);
    if (s > 0) scored.push({ ...item, score: s * 0.9, insert: `@[${item.label}](dsh-session:${btoaSafe(item.id)})` });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.max(1, limit));
}

/** localStorage-safe base64 (the session-reference URI payload). */
function btoaSafe(value) {
  try {
    const b = window.btoa(unescape(encodeURIComponent(String(value))));
    return b.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  } catch {
    return String(value);
  }
}

/**
 * Composer integration helper: given the textarea value + caret, detect an
 * active @token (from the last '@' before the caret with no space since).
 * Returns { token, start, end } or null.
 */
export function activeReferenceToken(text, caret) {
  const before = String(text || '').slice(0, caret === undefined ? (text || '').length : caret);
  const at = before.lastIndexOf('@');
  if (at < 0) return null;
  const token = before.slice(at + 1);
  if (/\s/.test(token) || token.length > 64) return null;
  return { token, start: at, end: at + 1 + token.length };
}

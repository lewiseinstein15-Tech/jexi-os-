/**
 * JEXI OS — Connector Inbox (B59).
 *
 * Durable, bounded log of inbound connector traffic — verified webhook events
 * and Meta hub.challenge handshakes — so a live provider → JEXI delivery can
 * be verified end-to-end from a browser (GET /api/connectors/:name/inbound),
 * with no shell and no Render log access.
 *
 * Persisted to DATA_DIR/connector-inbox.json (same persistent volume as
 * memory) so entries survive restarts; capped per connector so the file stays
 * small. Raw provider payloads are NOT stored (only the normalized event), so
 * no large media blobs or duplicated provider envelopes accumulate.
 */
import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../config.js';

const FILE = path.join(DATA_DIR, 'connector-inbox.json');
const MAX_EVENTS = 100;      // per connector
const MAX_HANDSHAKES = 25;   // per connector

let cache = null;

function load() {
  if (cache) return cache;
  cache = null;
  try {
    if (fs.existsSync(FILE)) cache = JSON.parse(fs.readFileSync(FILE, 'utf-8')) || {};
  } catch (e) { cache = {}; }
  if (!cache) cache = {};
  cache.events = cache.events || {};
  cache.handshakes = cache.handshakes || {};
  return cache;
}

function persist() {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(cache, null, 2), 'utf-8');
  } catch (e) {
    console.error('[connector-inbox] save error:', e);
  }
}

/** Store one normalized inbound event (raw provider envelope stripped). */
export function recordWebhookEvent(name, event) {
  const db = load();
  const list = db.events[name] || (db.events[name] = []);
  const { raw, ...safe } = event || {};
  list.push({ at: new Date().toISOString(), ...safe });
  if (list.length > MAX_EVENTS) db.events[name] = list.slice(-MAX_EVENTS);
  persist();
}

export function recordWebhookEvents(name, events) {
  for (const ev of events || []) recordWebhookEvent(name, ev);
}

/** Store one webhook verification handshake (Meta hub.challenge). */
export function recordHandshake(name, result) {
  const db = load();
  const list = db.handshakes[name] || (db.handshakes[name] = []);
  list.push({ at: new Date().toISOString(), ...(result || {}) });
  if (list.length > MAX_HANDSHAKES) db.handshakes[name] = list.slice(-MAX_HANDSHAKES);
  persist();
}

/** Recent events + handshakes for one connector, newest first. */
export function listInbound(name, limit = 50) {
  const db = load();
  const cap = Math.max(1, Math.min(Number(limit) || 50, 200));
  const events = (db.events[name] || []).slice(-cap).reverse();
  const handshakes = (db.handshakes[name] || []).slice(-cap).reverse();
  return { events, handshakes, total: (db.events[name] || []).length };
}

/**
 * B62 — group the inbox into conversations (chat-thread shape for the app).
 *
 * Inbound events (text/button/media…) become direction 'in' messages keyed by
 * the sender; our recorded auto-replies (type 'reply') become direction 'out'
 * messages keyed by the recipient — so each partner's thread shows both sides
 * of the conversation, newest last, exactly like a chat app.
 */
export function listConversations(name, limit = 30) {
  const db = load();
  const events = db.events[name] || [];
  const byPartner = new Map();
  for (const ev of events) {
    if (!ev || ev.type === 'rejected' || ev.type === 'handshake') continue;
    let partner;
    let msg;
    if (ev.type === 'reply') {
      partner = ev.to;
      msg = { direction: 'out', at: ev.at, text: ev.text || '', ok: ev.ok !== false, error: ev.error || null, wamid: ev.id || null, in_reply_to: ev.in_reply_to || null };
    } else {
      partner = ev.from;
      msg = { direction: 'in', at: ev.at, text: ev.text || '', id: ev.id || null, type: ev.type || 'unknown', media: ev.media || null, from: ev.from || null, to: ev.to || null };
    }
    if (!partner) continue;
    if (!byPartner.has(partner)) byPartner.set(partner, []);
    byPartner.get(partner).push(msg);
  }
  const conversations = [];
  for (const [partner, messages] of byPartner) {
    messages.sort((a, b) => String(a.at).localeCompare(String(b.at)));
    const last = messages[messages.length - 1];
    conversations.push({
      partner,
      lastAt: last.at,
      lastText: (last.text || (last.error ? `⚠ ${last.error}` : '')).slice(0, 140),
      messages: messages.slice(-80),
    });
  }
  conversations.sort((a, b) => String(b.lastAt).localeCompare(String(a.lastAt)));
  const cap = Math.max(1, Math.min(Number(limit) || 30, 100));
  return { conversations: conversations.slice(0, cap), total: conversations.length };
}

/** Test hook — wipe the inbox (memory + file). */
export function resetConnectorInbox() {
  cache = { events: {}, handshakes: {} };
  try { fs.rmSync(FILE, { force: true }); } catch (e) { /* noop */ }
}

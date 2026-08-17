/**
 * JEXI OS — Session Conversations (B96: DeepSeek-Harness-style session model).
 *
 * Every conversation is an APPEND-ONLY event log (like dsh's SessionEvent log):
 *   DATA_DIR/conversations/<convId>.jsonl
 * Each line: { seq, at, role, text, kind }  — durable, replayable.
 *
 *  - listConversations()  — titled (first user message), lastActive, counts.
 *  - forkConversation()   — seed a NEW conversation from an existing one
 *    (lineage: parentSession + seedLength), dsh's session fork.
 *  - searchConversations()— full-text search across ALL past conversations
 *    (the session_query tools), so JEXI can remember what she did before.
 *  - deleteConversation() — remove a conversation's log.
 *
 * Integrated with /api/chat: every user message + JEXI answer is appended to
 * the session's log, so JEXI has access to the CURRENT conversation AND every
 * PREVIOUS one (via the session_search tool).
 */

import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../config.js';

const CONV_DIR = path.join(DATA_DIR, 'conversations');
const MAX_EVENTS_PER_CONV = 2000;
const MAX_CONVERSATIONS = 200;

function convFile(convId) {
  return path.join(CONV_DIR, `${String(convId).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80)}.jsonl`);
}

/** Absolute path of a conversation's log file (shared with CompactionEngine). */
export function conversationFilePath(convId) {
  return convFile(convId);
}

function ensureDir() {
  try { fs.mkdirSync(CONV_DIR, { recursive: true }); } catch { /* noop */ }
}

/** Append one event to a conversation's append-only log. */
export function appendConversationEvent(convId, { role, text, kind = 'chat' }) {
  if (!convId) return null;
  ensureDir();
  const file = convFile(convId);
  const events = loadConversationEvents(convId);
  const seq = events.length ? events[events.length - 1].seq + 1 : 0;
  const ev = { seq, at: Date.now(), role: String(role || 'user'), text: String(text || '').slice(0, 20000), kind };
  try {
    fs.appendFileSync(file, JSON.stringify(ev) + '\n', 'utf-8');
  } catch (e) { /* memory must never break chat */ }
  // Cap: keep the tail.
  const all = loadConversationEvents(convId);
  if (all.length > MAX_EVENTS_PER_CONV) {
    try {
      const tail = all.slice(all.length - MAX_EVENTS_PER_CONV);
      fs.writeFileSync(file, tail.map((x) => JSON.stringify(x)).join('\n') + '\n', 'utf-8');
    } catch { /* noop */ }
  }
  return ev;
}

/** Read a conversation's event log (newest-last). */
export function loadConversationEvents(convId, limit = 500) {
  if (!convId) return [];
  try {
    const file = convFile(convId);
    if (!fs.existsSync(file)) return [];
    const lines = fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean);
    const parsed = [];
    for (const l of lines) {
      try { parsed.push(JSON.parse(l)); } catch { /* skip corrupt line */ }
    }
    return limit ? parsed.slice(-limit) : parsed;
  } catch { return []; }
}

/** One conversation's summary (title = first user message). */
export function conversationSummary(convId) {
  const events = loadConversationEvents(convId, 1000);
  if (!events.length) return null;
  const firstUser = events.find((e) => e.role === 'user');
  const jexiCount = events.filter((e) => e.role === 'jexi').length;
  return {
    id: convId,
    title: String(firstUser ? firstUser.text : '(empty)').replace(/\s+/g, ' ').slice(0, 80),
    messageCount: events.length,
    userMessages: events.filter((e) => e.role === 'user').length,
    jexiMessages: jexiCount,
    createdAt: events[0].at,
    lastActive: events[events.length - 1].at,
  };
}

/** List all conversations, newest-active first. */
export function listConversations() {
  ensureDir();
  try {
    const files = fs.readdirSync(CONV_DIR).filter((f) => f.endsWith('.jsonl'));
    const out = [];
    for (const f of files) {
      const id = f.replace(/\.jsonl$/, '');
      const s = conversationSummary(id);
      if (s) out.push(s);
    }
    out.sort((a, b) => b.lastActive - a.lastActive);
    return out.slice(0, MAX_CONVERSATIONS);
  } catch { return []; }
}

/** DSH-style fork: seed a new conversation from an existing one (lineage kept). */
export function forkConversation(sourceConvId, newConvId = null) {
  const parent = loadConversationEvents(sourceConvId, MAX_EVENTS_PER_CONV);
  if (!parent.length) return { ok: false, error: 'Source conversation is empty or missing' };
  const id = newConvId || `conv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  ensureDir();
  const seed = parent.map((e, i) => ({ ...e, seq: i }));
  try {
    fs.writeFileSync(convFile(id), seed.map((x) => JSON.stringify(x)).join('\n') + '\n', 'utf-8');
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'fork failed' };
  }
  return { ok: true, id, parentSession: sourceConvId, seedLength: seed.length };
}

/** Full-text search across ALL past conversations (session_query). */
export function searchConversations(query, { limit = 5 } = {}) {
  const q = String(query || '').toLowerCase().trim();
  if (q.length < 2) return [];
  const out = [];
  for (const c of listConversations()) {
    const events = loadConversationEvents(c.id, 500);
    const hits = [];
    for (const e of events) {
      const blob = String(e.text || '').toLowerCase();
      if (blob.includes(q)) {
        hits.push({ seq: e.seq, role: e.role, text: String(e.text || '').slice(0, 400), at: e.at });
        if (hits.length >= 3) break;
      }
    }
    if (hits.length) out.push({ conversation: c.title, id: c.id, lastActive: c.lastActive, hits });
    if (out.length >= limit) break;
  }
  return out;
}

export function deleteConversation(convId) {
  try {
    const file = convFile(convId);
    if (fs.existsSync(file)) fs.unlinkSync(file);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'delete failed' };
  }
}

export function conversationCount() {
  return listConversations().length;
}

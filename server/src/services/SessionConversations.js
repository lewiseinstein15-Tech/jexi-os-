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
import { getEvents } from './EventLog.js'; // B108 — tool-call stats per session
import { getStoredTitleRecord, clearStoredTitle, fallbackTitleFor } from './SessionTitles.js'; // B108/B109 — dsh session-title (pinned llm/user titles, word-capped fallback)
import { sessionStats } from './SessionStats.js'; // B109 — dsh session-stats projection fold

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

/** B130 — O(1) seq: read only the LAST line of the log (B119 lifecycle events
 *  made the old full-file read ×2 per append the hottest path in chat). */
function lastLineSeq(file) {
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      if (size === 0) return -1;
      const len = Math.min(size, 2048);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, Math.max(0, size - len));
      const lines = buf.toString('utf8').split('\n').filter(Boolean);
      for (let i = lines.length - 1; i >= 0; i--) {
        try { const p = JSON.parse(lines[i]); if (p && Number.isInteger(p.seq)) return p.seq; } catch { /* partial line */ }
      }
      return -1;
    } finally { fs.closeSync(fd); }
  } catch { return -1; }
}

/** Append one event to a conversation's append-only log (O(1) amortized). */
const eventObservers = new Set();

/** Subscribe to every appended conversation event (e.g. the sqlite mirror). */
export function onConversationEvent(fn) {
  eventObservers.add(fn);
  return () => eventObservers.delete(fn);
}

export function appendConversationEvent(convId, { role, text, kind = 'chat', meta }) {
  if (!convId) return null;
  ensureDir();
  const file = convFile(convId);
  let seq = 0;
  if (fs.existsSync(file)) {
    const last = lastLineSeq(file);
    seq = last >= 0 ? last + 1 : 0;
  }
  const ev = { seq, at: Date.now(), role: String(role || 'user'), text: String(text || '').slice(0, 20000), kind, ...(meta ? { meta } : {}) };
  try {
    fs.appendFileSync(file, JSON.stringify(ev) + '\n', 'utf-8');
  } catch (e) { /* memory must never break chat */ }
  for (const fn of eventObservers) { try { fn(convId, ev); } catch { /* an observer must never break chat */ } }
  // Cap: keep the tail — amortized (only every 64 appends).
  if (seq > 0 && seq % 64 === 0) {
    try {
      const all = loadConversationEvents(convId);
      if (all.length > MAX_EVENTS_PER_CONV) {
        const tail = all.slice(all.length - MAX_EVENTS_PER_CONV);
        fs.writeFileSync(file, tail.map((x) => JSON.stringify(x)).join('\n') + '\n', 'utf-8');
      }
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

/** One conversation's summary. B108 — title resolves to the stored LLM
 *  title (or manual rename) with the first-message fallback; stats include
 *  tool calls from the durable event log, approx tokens, duration and
 *  compaction count (dsh session-stats mirror). */
export function conversationSummary(convId) {
  const events = loadConversationEvents(convId, 1000);
  if (!events.length) return null;
  const firstUser = events.find((e) => e.role === 'user');
  // B109 — stored title (any source) wins; DSH word+byte-capped fallback.
  let title = null;
  let titleSource = 'fallback';
  try {
    const rec = getStoredTitleRecord(convId);
    if (rec && rec.title) { title = rec.title; titleSource = rec.source || 'llm'; }
  } catch { /* noop */ }
  if (!title) {
    title = fallbackTitleFor(convId) || String(firstUser ? firstUser.text : '(empty)').replace(/\s+/g, ' ').slice(0, 60);
  }
  // B109 — the session-stats projection fold (best-effort).
  let stats = {};
  try { stats = sessionStats(convId); } catch { /* noop */ }
  return {
    id: convId,
    title,
    titleSource,
    messageCount: events.filter((e) => e.kind === 'chat').length,
    userMessages: stats.userMessages ?? events.filter((e) => e.role === 'user').length,
    jexiMessages: stats.jexiMessages ?? events.filter((e) => e.role === 'jexi').length,
    toolCalls: stats.toolCalls ?? null,
    steps: stats.steps ?? null,
    turns: stats.turns ?? null,
    toolMs: stats.toolMs ?? null,
    llmMs: stats.llmMs ?? null,
    approxTokens: stats.approxTokens ?? null,
    durationMs: stats.durationMs ?? null,
    compactions: stats.compactions ?? 0,
    firstMessage: firstUser ? String(firstUser.text).replace(/\s+/g, ' ').slice(0, 200) : '',
    createdAt: events[0].at,
    lastActive: events[events.length - 1].at,
  };
}

/** B106 — recent OTHER sessions (dsh session-reference): titles of the last
 *  conversations before this one, so the model knows what was discussed. */
export function recentSessionsBlock(convId, limit = 5) {
  try {
    const all = listConversations().filter((c) => c.id !== convId).slice(0, Math.max(1, Number(limit) || 5));
    if (!all.length) return '';
    const lines = all.map((c) => `- "${c.title}" (${c.messageCount} messages, ${c.userMessages || 0} from you, last ${new Date(c.lastActive).toISOString().slice(0, 16)} UTC)`);
    return `\n[Earlier sessions (not this conversation — you may reference them via session-search):\n${lines.join('\n')}]\n`;
  } catch { return ''; }
}

/** B106 — session-log-export: the full conversation as JSONL or Markdown. */
export function exportConversation(convId, format = 'jsonl') {
  const events = loadConversationEvents(convId, 2000);
  if (!events.length) return { ok: false, error: 'conversation not found' };
  if (format === 'md') {
    const lines = ['# Conversation transcript', ''];
    for (const e of events) {
      if (e.kind === 'compaction/start' || e.kind === 'compaction/end') continue;
      if (e.kind === 'compaction') {
        lines.push(`> 📦 COMPACTED CHECKPOINT (shadowed ${e.meta?.shadowed?.events || '?'} turns):`);
        lines.push('> ' + String(e.text || '').replace(/\n/g, '\n> '));
        lines.push('');
        continue;
      }
      const who = e.role === 'user' ? 'You' : e.role === 'jexi' ? 'JEXI' : 'System';
      lines.push(`**${who}** (${new Date(e.at).toISOString()}):`);
      lines.push(String(e.text || '').trim());
      lines.push('');
    }
    return { ok: true, format: 'md', content: lines.join('\n') };
  }
  return { ok: true, format: 'jsonl', content: events.map((e) => JSON.stringify(e)).join('\n') };
}

/** B130 — cached list (10s): recentSessionsBlock ran this per message and it
 *  read EVERY conversation file each time. */
let listCache = { at: 0, value: null };

/** List all conversations, newest-active first (cached 10s). */
export function listConversations() {
  if (listCache.value && Date.now() - listCache.at < 10000) return listCache.value;
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
    listCache = { at: Date.now(), value: out.slice(0, MAX_CONVERSATIONS) };
    return listCache.value;
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
  try { clearStoredTitle(convId); } catch { /* noop */ }
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

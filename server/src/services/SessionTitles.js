/**
 * B108/B109 — SESSION TITLES (DeepSeek Harness `packages/session/session-title`
 * mirror, fidelity pass).
 *
 * DSH semantics implemented here:
 *  - fallback = leading WORDS of the first eligible human message, capped by
 *    word count AND UTF-8 bytes (fallbackSessionTitle);
 *  - accepted titles are normalized (control/escape stripping, whitespace
 *    collapse) and truncated by UTF-8 BYTES (normalizeSessionTitle);
 *  - source kinds: fallback | llm (provider) | user — an explicit user
 *    rename PINS the title: automatic generation stops scheduling;
 *  - a log-only `session/title` event records the accepted title, its
 *    source and the user-message seqs it was derived from.
 */

import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../config.js';
import { loadConversationEvents } from './SessionConversations.js';
import { fallbackSessionTitle, normalizeSessionTitle } from './TitleNormalize.js';
import { appendEvent } from './EventLog.js';

const TITLES_FILE = path.join(DATA_DIR, 'titles.json');
const MIN_USER_MESSAGES = 4;      // JEXI's generation threshold (DSH: after enough turns)
const FALLBACK_MAX_WORDS = 8;     // DSH fallbackMaxWords
const FALLBACK_MAX_BYTES = 80;    // DSH fallbackMaxBytes
const MAX_TITLE_BYTES = 60;       // DSH maxTitleBytes analog

let store = null;
let attempted = new Set();
const inFlight = new Set();

function loadStore() {
  if (store) return store;
  try { store = JSON.parse(fs.readFileSync(TITLES_FILE, 'utf-8')); } catch { store = {}; }
  if (!store || typeof store !== 'object') store = {};
  return store;
}

function persist() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(TITLES_FILE, JSON.stringify(store || {}), 'utf-8'); } catch { /* noop */ }
}

/** Stored title record: { title, at, source: 'llm'|'user', messageSeqs }. */
export function getStoredTitleRecord(convId) {
  return loadStore()[String(convId || '')] || undefined;
}

/** Stored title text (undefined when none). */
export function getStoredTitle(convId) {
  const r = getStoredTitleRecord(convId);
  return r && r.title ? r.title : undefined;
}

/** User rename — PINS the title (DSH: automatic generation stops scheduling). */
export function setStoredTitle(convId, title, source = 'user', messageSeqs = []) {
  const t = normalizeSessionTitle(title, MAX_TITLE_BYTES);
  if (!t) return { ok: false, error: 'title cannot be empty' };
  const id = String(convId);
  loadStore()[id] = { title: t, at: Date.now(), source, messageSeqs: Array.isArray(messageSeqs) ? messageSeqs : [] };
  persist();
  try {
    appendEvent('session_title', { conversation: id, title: t, source, messageSeqs: (Array.isArray(messageSeqs) ? messageSeqs : []).slice(0, 20) }, id);
  } catch { /* noop */ }
  return { ok: true, title: t, source };
}

/** Forget a conversation's title (delete path). */
/** B162d — wipe every stored session title (deep memory clear). */
export function clearAllStoredTitles() {
  try { store = {}; persist(); } catch { /* best-effort */ }
  try { attempted = new Set(); } catch { /* best-effort */ }
}

export function clearStoredTitle(convId) {
  const s = loadStore();
  delete s[String(convId || '')];
  attempted.delete(String(convId || ''));
  persist();
}

/* ---------------- generation ---------------- */

let generator = null;
export function setTitleGenerator(fn) {
  generator = typeof fn === 'function' ? fn : null;
}

/** Count a conversation's user messages (from its durable log). */
export function userMessageCount(convId) {
  try {
    const events = loadConversationEvents(convId, 500);
    return events.filter((e) => e.role === 'user' && e.kind === 'chat').length;
  } catch { return 0; }
}

/** The seqs of the user messages a title was/would-be derived from (DSH messageSeqs). */
export function titleMessageSeqs(convId) {
  try {
    return loadConversationEvents(convId, 500).filter((e) => e.role === 'user' && e.kind === 'chat').slice(0, 16).map((e) => e.seq);
  } catch { return []; }
}

/** Build a compact excerpt for the title model (first 16 user/jexi turns). */
function excerptFor(convId) {
  const events = loadConversationEvents(convId, 200).filter((e) => e.kind === 'chat');
  const lines = events.slice(0, 16).map((e) => {
    const who = e.role === 'user' ? 'User' : 'JEXI';
    return `${who}: ${String(e.text || '').replace(/\s+/g, ' ').slice(0, 140)}`;
  });
  return lines.join('\n').slice(0, 2500);
}

const TITLE_PROMPT = (excerpt) => `Here is the start of a conversation:\n\n${excerpt}\n\nWrite a SHORT title for this conversation: at most 6 words, no quotes, no trailing period, lowercase except proper nouns. Reply with ONLY the title.`;

/** DSH normalizeSessionTitle applied to a generated title. */
export function cleanTitle(raw, maxBytes = MAX_TITLE_BYTES) {
  return normalizeSessionTitle(raw, maxBytes);
}

async function generateTitle(convId) {
  if (generator) return cleanTitle(await generator(excerptFor(convId)));
  const { generateContent } = await import('./LLMClient.js');
  const raw = await generateContent(TITLE_PROMPT(excerptFor(convId)), 'You generate short conversation titles. Output only the title.', null, { temperature: 0.4 });
  return cleanTitle(raw);
}

/**
 * Auto-title once (fire-and-forget, one-shot). A pinned title (source
 * 'user' or any stored title) stops scheduling — DSH semantics.
 */
export async function maybeAutoTitle(convId) {
  const id = String(convId || '');
  if (!id) return false;
  const rec = getStoredTitleRecord(id);
  if (rec && rec.title) return false;          // already titled (any source pins)
  if (attempted.has(id)) return false;         // already tried once
  if (inFlight.has(id)) return false;
  if (userMessageCount(id) < MIN_USER_MESSAGES) return false;
  inFlight.add(id);
  try {
    const title = await generateTitle(id);
    if (title && title.length >= 2) {
      setStoredTitle(id, title, 'llm', titleMessageSeqs(id));
      return true;
    }
    return false;
  } catch { return false; }
  finally {
    inFlight.delete(id);
    attempted.add(id);
    persist();
  }
}

/** Boot sweep: title the most recent untitled conversations (bounded). */
export async function titleUntitledSweep({ max = 8 } = {}) {
  const { listConversations } = await import('./SessionConversations.js');
  let titled = 0;
  try {
    const convs = listConversations().filter((c) => !getStoredTitle(c.id) && !attempted.has(c.id) && c.userMessages >= MIN_USER_MESSAGES);
    for (const c of convs.slice(0, Math.max(1, Number(max) || 8))) {
      if (await maybeAutoTitle(c.id)) titled += 1;
    }
  } catch { /* best-effort */ }
  return { titled };
}

/** DSH deterministic fallback for a conversation: first user message, word+byte capped. */
export function fallbackTitleFor(convId) {
  const events = loadConversationEvents(convId, 500);
  const first = events.find((e) => e.role === 'user' && e.kind === 'chat');
  return first ? fallbackSessionTitle(first.text, FALLBACK_MAX_WORDS, FALLBACK_MAX_BYTES) : '(empty)';
}

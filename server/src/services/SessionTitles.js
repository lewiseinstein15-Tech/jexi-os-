/**
 * B108 — SESSION TITLES (mirror of DeepSeek Harness
 * `packages/session/session-title`).
 *
 * Conversations get a short LLM-generated title once they have enough
 * content, instead of raw first-message text. Titles are stored in
 * DATA_DIR/titles.json, resolve with a first-message fallback, can be
 * renamed manually, and are never allowed to break or slow a chat
 * (fire-and-forget, one-shot per conversation, injectable generator for
 * tests).
 */

import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../config.js';
import { loadConversationEvents } from './SessionConversations.js';

const TITLES_FILE = path.join(DATA_DIR, 'titles.json');
const MIN_USER_MESSAGES = 4;
const MAX_TITLE_CHARS = 60;

let store = null; // { [convId]: { title, at, source } }
let attempted = new Set(); // convIds we already tried (even on failure — no retry loops)
const inFlight = new Set(); // title generation currently running

function loadStore() {
  if (store) return store;
  try { store = JSON.parse(fs.readFileSync(TITLES_FILE, 'utf-8')); } catch { store = {}; }
  if (!store || typeof store !== 'object') store = {};
  return store;
}

function persist() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(TITLES_FILE, JSON.stringify(store || {}), 'utf-8'); } catch { /* noop */ }
}

/** Stored title for a conversation (undefined when none). */
export function getStoredTitle(convId) {
  const s = loadStore()[String(convId || '')];
  return s && s.title ? s.title : undefined;
}

/** Manually set (rename) or overwrite a conversation's title. */
export function setStoredTitle(convId, title, source = 'manual') {
  const t = String(title || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE_CHARS);
  if (!t) return { ok: false, error: 'title cannot be empty' };
  loadStore()[String(convId)] = { title: t, at: Date.now(), source };
  persist();
  return { ok: true, title: t, source };
}

/** Forget a conversation's title (delete path). */
export function clearStoredTitle(convId) {
  const s = loadStore();
  delete s[String(convId || '')];
  attempted.delete(String(convId || ''));
  persist();
}

/* ---------------- generation ---------------- */

/** Injectable title generator for tests: (excerpt) => Promise<string>. */
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

/** Build a compact excerpt for the title model. */
function excerptFor(convId) {
  const events = loadConversationEvents(convId, 200).filter((e) => e.kind === 'chat');
  const lines = events.slice(0, 16).map((e) => {
    const who = e.role === 'user' ? 'User' : 'JEXI';
    return `${who}: ${String(e.text || '').replace(/\s+/g, ' ').slice(0, 140)}`;
  });
  return lines.join('\n').slice(0, 2500);
}

const TITLE_PROMPT = (excerpt) => `Here is the start of a conversation:\n\n${excerpt}\n\nWrite a SHORT title for this conversation: at most 6 words, no quotes, no trailing period, lowercase except proper nouns. Reply with ONLY the title.`;

/** Clean a generated title into a safe string. */
export function cleanTitle(raw) {
  const t = String(raw || '')
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .replace(/[.\s]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TITLE_CHARS);
  return t;
}

async function generateTitle(convId) {
  if (generator) {
    const raw = await generator(excerptFor(convId));
    return cleanTitle(raw);
  }
  const { generateContent } = await import('./LLMClient.js');
  const raw = await generateContent(TITLE_PROMPT(excerptFor(convId)), 'You generate short conversation titles. Output only the title.', null, { temperature: 0.4 });
  return cleanTitle(raw);
}

/**
 * Auto-title a conversation once it has enough content (fire-and-forget,
 * one-shot). Returns true when a title was stored.
 */
export async function maybeAutoTitle(convId) {
  const id = String(convId || '');
  if (!id) return false;
  if (getStoredTitle(id)) return false;            // already titled
  if (attempted.has(id)) return false;             // already tried once
  if (inFlight.has(id)) return false;              // already running
  if (userMessageCount(id) < MIN_USER_MESSAGES) return false;
  inFlight.add(id);
  try {
    const title = await generateTitle(id);
    if (title && title.length >= 3) {
      setStoredTitle(id, title, 'llm');
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
      const okT = await maybeAutoTitle(c.id);
      if (okT) titled += 1;
    }
  } catch { /* best-effort */ }
  return { titled };
}

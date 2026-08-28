/**
 * JEXI OS — Event Log (B78, event-sourced logging).
 *
 * Every meaningful thing that happens is recorded as a structured, ordered
 * event — the source of truth for what happened, per session, in order:
 *
 *   user_message           the incoming request (source: chat / email / webhook / …)
 *   orchestrator_decision  the complexity classification (SIMPLE/COMPLEX), which
 *                          coworker(s) were selected, and the reasoning
 *   coworker_call          which provider/model was invoked, what it was asked
 *   coworker_result        what came back — ok / fell back / failed
 *   tool_call              any connector/tool invocation with real parameters
 *   tool_result            the real result of that tool call
 *   context_compaction     every conversation-summary regeneration + trigger
 *   error                  failures with component, message and fallback info
 *
 * Persistence uses the SAME Redis-backed mechanism as the memory core
 * (MemoryManager.getRedis — REDIS_URL): the store is mirrored to Redis as a
 * JSON blob with the same 30-day TTL, so it survives redeploys on Render.
 * No second persistence mechanism is introduced.
 */

import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../config.js';
import { getRedis, getActiveSession } from './MemoryManager.js';

const EVENTS_FILE = path.join(DATA_DIR, 'events.json');
const EVENTS_REDIS_KEY = 'jexi:events';
const EVENTS_TTL = 60 * 60 * 24 * 30; // 30 days — same window as the memory mirror
const MAX_EVENTS = 3000;              // global ceiling — drop oldest
const MAX_PER_SESSION = 500;          // per-session ceiling — drop that session's oldest

const EVENT_TYPES = new Set([
  'user_message',
  'orchestrator_decision',
  'coworker_call',
  'coworker_result',
  'tool_call',
  'tool_result',
  'context_compaction',
  'session_title', // B109 — dsh session/title log event
  'error',
]);

let cache = null;

function load() {
  if (cache) return cache;
  try {
    if (fs.existsSync(EVENTS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(EVENTS_FILE, 'utf-8'));
      if (Array.isArray(parsed.events)) {
        cache = { version: 1, events: parsed.events };
        return cache;
      }
    }
  } catch (e) {
    console.error('[EventLog] load error:', e.message);
  }
  cache = { version: 1, events: [] };
  return cache;
}

/** Local file write + fire-and-forget Redis mirror (same pattern as saveMemory). */
function persist() {
  try {
    fs.mkdirSync(path.dirname(EVENTS_FILE), { recursive: true });
    fs.writeFileSync(EVENTS_FILE, JSON.stringify(load(), null, 2), 'utf-8');
  } catch (e) {
    console.error('[EventLog] save error:', e.message);
  }
  eventsRedisPush(load()).catch(() => {});
}

async function eventsRedisPush(store) {
  const r = await getRedis();
  if (!r) return;
  try {
    await r.set(EVENTS_REDIS_KEY, JSON.stringify(store), 'EX', EVENTS_TTL);
  } catch (e) {
    // Non-fatal: the local file is always the fast layer; Redis is the
    // durable mirror for redeploys. A Redis hiccup must never break a chat.
  }
}

/** Boot-time hydrate from Redis (same pattern as the memory core). */
export async function hydrateEventLogFromRedis() {
  const r = await getRedis();
  if (!r) return false;
  try {
    const raw = await r.get(EVENTS_REDIS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.events)) {
        cache = parsed;
        try {
          fs.mkdirSync(path.dirname(EVENTS_FILE), { recursive: true });
          fs.writeFileSync(EVENTS_FILE, JSON.stringify(cache, null, 2), 'utf-8');
        } catch (e) {}
        console.log('[EventLog] ✓ Hydrated event log from Redis.');
        return true;
      }
    }
  } catch (e) {
    console.error('[EventLog] Redis hydrate failed, using local file:', e.message);
  }
  return false;
}

/** Strip non-JSON values and bound string sizes so the store stays lean. */
function sanitize(payload) {
  const out = {};
  for (const [k, v] of Object.entries(payload || {})) {
    if (typeof v === 'string') out[k] = v.slice(0, 4000);
    else if (typeof v === 'number' || typeof v === 'boolean' || v === null) out[k] = v;
    else if (Array.isArray(v)) out[k] = v.slice(0, 25).map((x) => (typeof x === 'string' ? x.slice(0, 200) : x));
    else if (typeof v === 'object') out[k] = sanitize(v);
  }
  return out;
}

/**
 * Append one event. Never throws, never blocks the caller. The session id
 * defaults to the active conversation (MemoryManager's active session) when
 * not passed explicitly — the chat handler sets it per request.
 */
export function appendEvent(type, payload = {}, session) {
  try {
    if (!EVENT_TYPES.has(type)) return false;
    const store = load();
    const sid = String(session || getActiveSession() || 'default').slice(0, 120);
    const event = {
      ts: new Date().toISOString(),
      type,
      session: sid,
      payload: sanitize(payload),
    };
    store.events.push(event);
    if (store.events.length > MAX_EVENTS) store.events.splice(0, store.events.length - MAX_EVENTS);
    const perSession = store.events.filter((e) => e.session === sid).length;
    if (perSession > MAX_PER_SESSION) {
      const first = store.events.findIndex((e) => e.session === sid);
      if (first >= 0) store.events.splice(first, perSession - MAX_PER_SESSION);
    }
    persist();
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Query the log. Events are returned in TRUE order (oldest → newest) so
 * downstream consumers (memory recall, debugging, FIXLOG-style verification)
 * can replay exactly what happened. Optional session / type filters.
 */
export function getEvents({ session, limit = 50, type } = {}) {
  const store = load();
  let list = store.events;
  if (session) list = list.filter((e) => e.session === String(session).slice(0, 120));
  if (type) list = list.filter((e) => e.type === type);
  return list.slice(-Math.min(Math.max(1, Number(limit) || 50), 500));
}

/** B162d — wipe the whole durable event log (deep memory clear). */
export function clearEventLog() {
  try {
    cache = { version: 1, events: [] }; // same shape as load()'s default
    persist();
  } catch { /* best-effort */ }
}

/** Diagnostic counts for /api/events and the health surface. */
export function eventLogStats() {
  const store = load();
  const byType = {};
  for (const e of store.events) byType[e.type] = (byType[e.type] || 0) + 1;
  const sessions = new Set(store.events.map((e) => e.session)).size;
  return { total: store.events.length, sessions, byType };
}

/**
 * B100 — COMPACTION ENGINE (mirror of DeepSeek Harness
 * `packages/compaction/compaction-basic` + `packages/compaction/compaction`).
 *
 * When a conversation's history grows past a token-pressure threshold, the
 * OLDER range is summarized by the LLM into a single structured checkpoint
 * and the log is rewritten as [checkpoint, ...retained-tail] — exactly dsh's
 * "summarize an older range into a single surface node" model:
 *
 *   - compaction/start  — log-only marker (the lock; a start without a later
 *                         end signals a crashed compaction)
 *   - <checkpoint>      — one user-role event carrying the <compacted-summary>
 *   - compaction/end    — log-only marker (lock released)
 *
 * The checkpoint lands at the position of the shadowed range, so surface
 * order is preserved; summaries are structured (dsh summarizer contract) so
 * a later session can resume with no loss of essential context. Long
 * conversations render as checkpoint + tail instead of the full transcript.
 */

import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../config.js';
import { conversationFilePath, loadConversationEvents } from './SessionConversations.js';
import { generateContent } from './LLMClient.js';
import { appendEvent } from './EventLog.js'; // B102 — compaction is a first-class durable event

/** Auto-compaction pressure: total chat characters before we compact. */
export const AUTO_COMPACT_THRESHOLD_CHARS = 45000;
/** DSH default thresholdRatio analog (80% of a ~56k-char budget). */
export const AUTO_COMPACT_RATIO = 0.8;
/** DSH default retainRatio (16%): the newest tail stays verbatim. */
export const RETAIN_RATIO = 0.16;
/** Minimum tail retained (chars) so recent work always survives. */
export const MIN_RETAIN_CHARS = 6000;
/** Minimum old-range size worth summarizing (else compaction is a no-op). */
export const MIN_COMPACT_CHARS = 10000;
export const MIN_COMPACT_EVENTS = 8;

const COMPACT_DIR = path.join(DATA_DIR, 'compaction');
const LOCK_FILE = path.join(COMPACT_DIR, 'locks.json');

/** Structured checkpoint sections (dsh summarizer mirror). */
const SUMMARY_SECTIONS = [
  '## Primary Request and Intent',
  '## Key Technical Concepts',
  '## Files and Code',
  '## Errors and Fixes',
  '## Pending Jobs',
  '## Decisions and Preferences',
];

const COMPACTION_INSTRUCTION = [
  'You are now acting as a compaction engine for this AI assistant. Condense the conversation ABOVE into a structured checkpoint that lets another session resume the work with no loss of essential context.',
  '',
  'Output EXACTLY the Markdown structure below: keep every section, in order. Use terse bullets, not prose paragraphs. Write "(none)" for an empty section — never drop a section.',
  '',
  ...SUMMARY_SECTIONS,
].join('\n');

/** In-process compaction lock (per conversation). */
const compacting = new Set();

/* ---------------- pressure ---------------------------------------------- */

/** Approximate token pressure of a conversation (chars/4 ≈ tokens). */
export function conversationPressure(convId) {
  const events = loadConversationEvents(convId, 2000);
  let chars = 0;
  let chatEvents = 0;
  for (const e of events) {
    if (e.kind && String(e.kind).startsWith('compaction')) continue;
    chars += String(e.text || '').length;
    chatEvents += 1;
  }
  return { chars, events: chatEvents, approxTokens: Math.round(chars / 4) };
}

/** Is this event a compaction artifact (hidden from normal rendering)? */
export function isCompactionEvent(ev) {
  return !!ev && typeof ev.kind === 'string' && ev.kind.startsWith('compaction');
}

/** Find the most recent checkpoint event (kind === 'compaction'). */
export function lastCheckpoint(convId) {
  const events = loadConversationEvents(convId, 2000);
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].kind === 'compaction') return events[i];
  }
  return null;
}

/**
 * Compaction-aware history: the newest checkpoint + the events after it.
 * Context builders render checkpoint + tail instead of the full transcript.
 */
export function compactionAwareHistory(convId, { limit = 500 } = {}) {
  const events = loadConversationEvents(convId, limit);
  let cpIndex = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].kind === 'compaction') { cpIndex = i; break; }
  }
  if (cpIndex === -1) return { checkpoint: null, tail: events };
  return {
    checkpoint: events[cpIndex],
    tail: events.slice(cpIndex + 1).filter((e) => !isCompactionEvent(e)),
  };
}

/** Human-readable status for the app. */
export function compactionStatus(convId) {
  const p = conversationPressure(convId);
  const cp = lastCheckpoint(convId);
  return {
    id: convId,
    chars: p.chars,
    events: p.events,
    approxTokens: p.approxTokens,
    threshold: AUTO_COMPACT_THRESHOLD_CHARS,
    overThreshold: p.chars > AUTO_COMPACT_THRESHOLD_CHARS,
    lastCheckpoint: cp ? {
      at: cp.at,
      shadowed: cp.meta ? cp.meta.shadowed : null,
      text: String(cp.text || '').slice(0, 200),
    } : null,
  };
}

/* ---------------- lock (dsh durable bracket analog) --------------------- */

function loadLocks() {
  try { return JSON.parse(fs.readFileSync(LOCK_FILE, 'utf-8')); } catch { return {}; }
}
function saveLocks(locks) {
  try { fs.mkdirSync(COMPACT_DIR, { recursive: true }); fs.writeFileSync(LOCK_FILE, JSON.stringify(locks), 'utf-8'); } catch { /* noop */ }
}

/** A live lock is a compaction/start with no matching compaction/end. */
export function hasLiveLock(convId) {
  if (compacting.has(convId)) return true;
  const locks = loadLocks();
  return !!locks[convId] && Date.now() - (locks[convId].at || 0) < 10 * 60 * 1000;
}

function acquireLock(convId) {
  if (compacting.has(convId)) return false;
  compacting.add(convId);
  const locks = loadLocks();
  locks[convId] = { at: Date.now() };
  saveLocks(locks);
  return true;
}

function releaseLock(convId) {
  compacting.delete(convId);
  const locks = loadLocks();
  delete locks[convId];
  saveLocks(locks);
}

/* ---------------- summarization (dsh summarizer mirror) ----------------- */

function transcriptOf(events) {
  const lines = [];
  for (const e of events) {
    if (isCompactionEvent(e)) continue;
    const role = e.role === 'user' ? 'USER' : 'JEXI';
    lines.push(`[${role}] ${String(e.text || '').replace(/\n+/g, ' ').slice(0, 800)}`);
  }
  const joined = lines.join('\n');
  return joined.length > 30000 ? `${joined.slice(0, 30000)}\n…(truncated)` : joined;
}

async function summarizeRange(events, signal) {
  const transcript = transcriptOf(events);
  const prompt = `${transcript}\n\n${COMPACTION_INSTRUCTION}`;
  const summary = await generateContent(
    prompt,
    'You are JEXI OS, acting as the compaction engine. Output only the structured checkpoint.',
    null,
    { temperature: 0.3, signal }
  );
  const text = String(summary || '').trim();
  if (text.length < 120) throw new Error('summarizer returned an unusably short checkpoint');
  const wrapped = `<compacted-summary>\n${text}\n</compacted-summary>`;
  return wrapped.length > 20000 ? wrapped.slice(0, 20000) : wrapped;
}

/* ---------------- the compaction operation ------------------------------ */

/**
 * Pick the cut: retain the newest tail (≥16% or ≥6k chars, at least 4 events)
 * at a clean exchange boundary (the tail starts at a user message, so a
 * user→JEXI pair is never split — dsh tool-pairing boundary analog).
 */
function pickCut(events, totalChars) {
  if (events.length < MIN_COMPACT_EVENTS + 4) return null;
  const retainTarget = Math.max(MIN_RETAIN_CHARS, Math.round(totalChars * RETAIN_RATIO));
  let tailChars = 0;
  let cut = events.length;
  for (let i = events.length - 1; i >= 0; i--) {
    if (isCompactionEvent(events[i])) continue;
    tailChars += String(events[i].text || '').length;
    cut = i;
    if (tailChars >= retainTarget && (events.length - i) >= 4) break;
  }
  // Snap to a clean boundary: the tail must start at a user message (or the
  // cut may sit between a JEXI answer and the next user turn).
  while (cut < events.length && events[cut].role !== 'user') cut += 1;
  if (cut >= events.length) return null;
  const oldRange = events.slice(0, cut);
  const oldChars = oldRange.reduce((a, e) => a + String(e.text || '').length, 0);
  if (oldRange.length < MIN_COMPACT_EVENTS || oldChars < MIN_COMPACT_CHARS) return null;
  return { cut, oldRange, oldChars };
}

/**
 * Consider automatic compaction for a conversation.
 * @returns {Promise<{compacted:boolean, summary?:string, status?:object, error?:string} | null>}
 *          null when no compaction is needed/possible.
 */
export async function maybeCompact(convId, { force = false, signal, summarizer } = {}) {
  if (!convId) return null;
  const p = conversationPressure(convId);
  if (!force && !(p.chars > AUTO_COMPACT_THRESHOLD_CHARS)) return null;
  if (hasLiveLock(convId)) return { compacted: false, error: 'compaction already in progress' };

  const events = loadConversationEvents(convId, 2000);
  const cut = pickCut(events, p.chars);
  if (!cut) return null;

  if (!acquireLock(convId)) return { compacted: false, error: 'compaction already in progress' };
  try {
    // `summarizer` is a test seam; production uses the LLM checkpoint prompt.
    const summary = typeof summarizer === 'function'
      ? await summarizer(cut.oldRange, signal)
      : await summarizeRange(cut.oldRange, signal);
    rewriteWithCheckpoint(convId, events, cut, summary);
    return { compacted: true, summary, status: compactionStatus(convId) };
  } catch (e) {
    return { compacted: false, error: `compaction failed: ${(e && e.message) || e}` };
  } finally {
    releaseLock(convId);
  }
}

/** Force compaction of one conversation (the /compact command + API). */
export function compactNow(convId, opts = {}) {
  return maybeCompact(convId, { force: true, ...opts });
}

/**
 * Rewrite the log as [compaction/start, checkpoint, ...tail, compaction/end].
 * The checkpoint's meta records the shadowed range (start/end seqs + counts),
 * dsh's surfaceOp.replace analog.
 */
function rewriteWithCheckpoint(convId, events, cut, summary) {
  const file = conversationFilePath(convId);
  const now = Date.now();
  const startEv = { seq: -1, at: now, role: 'system', text: '', kind: 'compaction/start' };
  const cpSeq = events.length ? events[events.length - 1].seq + 1 : 0;
  const checkpointEv = {
    seq: cpSeq,
    at: now,
    role: 'user',
    text: summary,
    kind: 'compaction',
    meta: {
      op: 'replace',
      start: events[0] ? events[0].seq : 0,
      end: cut.cut > 0 ? events[cut.cut - 1].seq : 0,
      shadowed: { events: cut.cut, chars: cut.oldChars },
      retained: events.length - cut.cut,
    },
  };
  const endEv = { seq: cpSeq + 1, at: Date.now(), role: 'system', text: '', kind: 'compaction/end' };
  const tail = events.slice(cut.cut).map((e) => ({ ...e }));
  const retainedChars = tail.reduce((a, e) => a + String(e.text || '').length, 0);
  checkpointEv.meta.retainedChars = retainedChars;
  const lines = [startEv, checkpointEv, ...tail, endEv].map((e) => JSON.stringify(e));
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, lines.join('\n') + '\n', 'utf-8');
    // B102 — the durable event log records the compaction (dsh compaction/*
    // events), so the session trace can replay it.
    try {
      appendEvent('context_compaction', {
        conversation: convId,
        shadowed: checkpointEv.meta.shadowed,
        retained: checkpointEv.meta.retained,
        checkpointChars: String(summary || '').length,
      }, convId);
    } catch { /* the event log must never break a compaction */ }
  } catch (e) {
    throw new Error(`checkpoint write failed: ${(e && e.message) || e}`);
  }
}

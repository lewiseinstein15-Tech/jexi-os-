/**
 * B106 — MESSAGE FEEDBACK (mirror of DeepSeek Harness
 * `packages/feedback/message-feedback`).
 *
 * Users rate JEXI answers (thumbs up/down, optional note). Feedback is
 * appended to the conversation's durable log (visible in the session trace,
 * like dsh's feedback session events) AND stored in a capped local store
 * with a Redis mirror for diagnostics.
 */

import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../config.js';
import { appendConversationEvent } from './SessionConversations.js';

const FEEDBACK_FILE = path.join(DATA_DIR, 'feedback.json');
const MAX_FEEDBACK = 500;

function load() {
  try { return JSON.parse(fs.readFileSync(FEEDBACK_FILE, 'utf-8')); } catch { return []; }
}

function save(list) {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(FEEDBACK_FILE, JSON.stringify(list), 'utf-8'); } catch { /* noop */ }
}

/**
 * Record feedback on a JEXI answer.
 * @param {{ conversation: string, seq?: number, rating: 1|-1, note?: string }} input
 */
export function addFeedback({ conversation, seq = null, rating, note }) {
  const r = Number(rating);
  if (r !== 1 && r !== -1) return { ok: false, error: 'rating must be 1 (helpful) or -1 (not helpful)' };
  const entry = {
    at: Date.now(),
    conversation: String(conversation || '').slice(0, 80),
    seq: seq === null || seq === undefined ? null : Number(seq),
    rating: r,
    note: String(note || '').slice(0, 500),
  };
  const list = load();
  list.push(entry);
  while (list.length > MAX_FEEDBACK) list.shift();
  save(list);
  // dsh mirror: feedback lands in the conversation log (the trace shows it).
  if (entry.conversation) {
    try {
      appendConversationEvent(entry.conversation, {
        role: 'system',
        kind: 'feedback',
        text: `User rated the previous answer ${r === 1 ? 'HELPFUL 👍' : 'NOT HELPFUL 👎'}${entry.note ? ` — ${entry.note}` : ''}`,
      });
    } catch { /* noop */ }
  }
  return { ok: true, ...entry };
}

/** Feedback for one conversation, newest first. */
export function listFeedback(conversation = null, limit = 50) {
  const list = load().filter((f) => !conversation || f.conversation === String(conversation));
  return list.slice(-Math.max(1, Number(limit) || 50)).reverse();
}

/** Aggregate stats (open diagnostics endpoint). */
export function feedbackStats() {
  const list = load();
  const helpful = list.filter((f) => f.rating === 1).length;
  const notHelpful = list.filter((f) => f.rating === -1).length;
  return {
    total: list.length,
    helpful,
    notHelpful,
    helpfulRate: list.length ? Math.round((helpful / list.length) * 100) : null,
    last: list.length ? list[list.length - 1] : null,
  };
}

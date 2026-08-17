/**
 * B119 — SESSION LIFECYCLE EVENTS (DeepSeek Harness session-event vocabulary
 * mirror: packages/core/agent-loop + packages/core/session).
 *
 * DSH appends typed events to the session log at every lifecycle boundary:
 *   turn/start → step/start → user/message → assistant/chunk →
 *   tool/call → tool/result → assistant/message → step/end → turn/end
 *
 * JEXI mirrors this by appending the same vocabulary to the conversation's
 * append-only log (kind = event type, role 'system', minimal text). The
 * trace view and replay then show the EXACT lifecycle, and title/search/
 * counts ignore lifecycle events (they filter kind === 'chat').
 */

import { appendConversationEvent } from './SessionConversations.js';

const LIFECYCLE_KINDS = new Set(['turn/start', 'turn/end', 'step/start', 'step/end', 'tool/call', 'tool/result', 'assistant/message', 'user/message']);

/** Is this event a lifecycle marker (excluded from chat counts/titles)? */
export function isLifecycleEvent(ev) {
  return !!ev && typeof ev.kind === 'string' && LIFECYCLE_KINDS.has(ev.kind);
}

/** Append a lifecycle event to the conversation log (best-effort). */
export function appendLifecycle(convId, kind, text, meta) {
  if (!convId) return null;
  try {
    return appendConversationEvent(convId, {
      role: 'system',
      kind: String(kind).slice(0, 30),
      text: String(text || '').slice(0, 400),
      meta: meta || undefined,
    });
  } catch { return null; }
}

/** DSH turn/start. */
export function lifecycleTurnStart(convId, turn) {
  return appendLifecycle(convId, 'turn/start', `turn ${turn}`, { turn });
}

/** DSH turn/end with reason (completed|max-tokens|aborted|error|blocked). */
export function lifecycleTurnEnd(convId, turn, reason = 'completed') {
  return appendLifecycle(convId, 'turn/end', `turn ${turn} → ${reason}`, { turn, reason });
}

/** DSH step/start. */
export function lifecycleStepStart(convId, turn, step) {
  return appendLifecycle(convId, 'step/start', `turn ${turn} step ${step}`, { turn, step });
}

/** DSH step/end. */
export function lifecycleStepEnd(convId, turn, step) {
  return appendLifecycle(convId, 'step/end', `turn ${turn} step ${step}`, { turn, step });
}

/** DSH tool/call {callId, name, arguments}. */
export function lifecycleToolCall(convId, turn, step, callId, name, args) {
  return appendLifecycle(convId, 'tool/call', `${name}(${JSON.stringify(args || {}).slice(0, 200)})`, { turn, step, callId, name, arguments: JSON.stringify(args || {}).slice(0, 500) });
}

/** DSH tool/result (cites the callId). */
export function lifecycleToolResult(convId, turn, step, callId, name, ok, error, durationMs) {
  return appendLifecycle(convId, 'tool/result', `${name} → ${ok ? 'ok' : 'error'}${durationMs ? ` (${durationMs}ms)` : ''}`, { turn, step, callId, name, ok: !!ok, error: String(error || '').slice(0, 200), durationMs });
}

/** DSH assistant/message (the answer lands, with stats). */
export function lifecycleAssistantMessage(convId, turn, step, text, stats = {}) {
  return appendLifecycle(convId, 'assistant/message', String(text || '').slice(0, 300), { turn, step, stats });
}

/** DSH user/message. */
export function lifecycleUserMessage(convId, turn, text) {
  return appendLifecycle(convId, 'user/message', String(text || '').slice(0, 300), { turn });
}

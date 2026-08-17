/**
 * B102 — SESSION TRACE (mirror of DeepSeek Harness' web session explorer).
 *
 * A per-conversation observability view assembled from the durable event
 * log (EventLog) + the conversation's compaction checkpoints: every tool
 * call and its real outcome, coworker calls, user messages, errors, and
 * context compactions — in order, replayable. The frontend renders this as
 * the TRACE view of a conversation.
 */

import { getEvents } from './EventLog.js';
import { loadConversationEvents, conversationSummary } from './SessionConversations.js';
import { isCompactionEvent } from './CompactionEngine.js';

/**
 * Build one conversation's trace.
 * @param {string} convId
 * @param {{limit?: number}} [opts]
 * @returns {{ events: object[], compaction: object[], counts: object, summary: object|null, lastActivity: number|null }}
 */
export function buildTrace(convId, { limit = 200 } = {}) {
  const cap = Math.min(Math.max(1, Number(limit) || 200), 500);
  const events = getEvents({ session: convId, limit: cap });
  const conv = loadConversationEvents(convId, 1000);
  const compaction = conv.filter((e) => e.kind === 'compaction').map((e) => ({
    at: e.at,
    shadowed: e.meta ? e.meta.shadowed : null,
    retained: e.meta ? e.meta.retained : null,
    text: String(e.text || '').slice(0, 400),
  }));
  const counts = {};
  for (const e of events) counts[e.type] = (counts[e.type] || 0) + 1;
  const summary = conversationSummary(convId);
  const last = events.length ? events[events.length - 1] : null;
  return {
    convId,
    events,
    compaction,
    counts,
    summary,
    lastActivity: last ? new Date(last.ts).getTime() : (summary ? summary.lastActive : null),
  };
}

/** Human label for one trace event type (frontend helper mirror). */
export function traceEventLabel(type) {
  const labels = {
    user_message: 'User message',
    orchestrator_decision: 'Orchestrator decision',
    coworker_call: 'Coworker call',
    coworker_result: 'Coworker result',
    tool_call: 'Tool call',
    tool_result: 'Tool result',
    context_compaction: 'Context compaction',
    error: 'Error',
  };
  return labels[type] || type;
}

/** Is a trace event a compaction marker (drawn distinctly in the UI)? */
export function isTraceCompaction(type) {
  return type === 'context_compaction';
}

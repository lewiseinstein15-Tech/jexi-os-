/**
 * B109 — SESSION STATS (DeepSeek Harness `packages/session/session-stats`
 * projection mirror).
 *
 * DSH folds the whole session log into counts + wall times. JEXI's durable
 * event log is folded the same way:
 *   turns   = user_message events (each user message opens a turn)
 *   steps   = closed execution steps: tool_result + coworker_result events
 *   toolCalls = tool_call events
 *   toolMs  = Σ durationMs over tool_result events (tool/call → tool/result pairs)
 *   llmMs   = Σ durationMs over coworker_result events (when recorded)
 * plus content figures (approx tokens, wall duration, compactions) from the
 * conversation log.
 */

import { getEvents } from './EventLog.js';
import { loadConversationEvents } from './SessionConversations.js';

export function sessionStats(convId) {
  const events = getEvents({ session: convId, limit: 500 });
  let turns = 0, steps = 0, toolCalls = 0, toolMs = 0, llmMs = 0;
  for (const e of events) {
    const p = e.payload || {};
    if (e.type === 'user_message') turns += 1;
    else if (e.type === 'tool_call') toolCalls += 1;
    else if (e.type === 'tool_result') {
      steps += 1;
      if (typeof p.durationMs === 'number') toolMs += p.durationMs;
    } else if (e.type === 'coworker_result') {
      steps += 1;
      if (typeof p.durationMs === 'number') llmMs += p.durationMs;
    }
  }
  const conv = loadConversationEvents(convId, 1000);
  const chars = conv.reduce((a, e) => a + String(e.text || '').length, 0);
  let compactions = 0;
  for (const e of conv) if (e.kind === 'compaction') compactions += 1;
  return {
    turns,
    steps,
    toolCalls,
    toolMs,
    llmMs,
    approxTokens: Math.round(chars / 4),
    durationMs: conv.length ? conv[conv.length - 1].at - conv[0].at : 0,
    compactions,
    messageCount: conv.length,
    userMessages: conv.filter((e) => e.role === 'user' && e.kind === 'chat').length,
    jexiMessages: conv.filter((e) => e.role === 'jexi').length,
  };
}

/**
 * B133 — SESSION INVARIANTS (DeepSeek Harness
 * `packages/runtime-diagnostics/invariants` mirror).
 *
 * Diagnostic checks over a conversation's append-only log: lifecycle
 * bracket balance (every turn/start has a turn/end, every step/start has a
 * step/end), tool/call→tool/result pairing, seq monotonicity, and
 * compaction bracket balance. Reports problems as a list — never throws.
 */

import { loadConversationEvents } from './SessionConversations.js';

/** Check one conversation's log. Returns { ok, problems: [{kind, detail}] }. */
export function checkConversationInvariants(convId) {
  const problems = [];
  const events = loadConversationEvents(convId, 2000);
  if (!events.length) return { ok: true, problems: [], events: 0 };

  let turnOpen = 0;
  let stepOpen = 0;
  let compactOpen = 0;
  const openCalls = new Set();
  let prevSeq = -1;

  for (const e of events) {
    // seq monotonic
    if (Number.isInteger(e.seq)) {
      if (e.seq < prevSeq) problems.push({ kind: 'seq-regression', detail: `seq ${e.seq} after ${prevSeq}` });
      prevSeq = e.seq;
    }
    switch (e.kind) {
      case 'turn/start': turnOpen += 1; break;
      case 'turn/end':
        turnOpen -= 1;
        if (turnOpen < 0) { problems.push({ kind: 'unbalanced-turn-end', detail: 'turn/end without turn/start' }); turnOpen = 0; }
        break;
      case 'step/start': stepOpen += 1; break;
      case 'step/end':
        stepOpen -= 1;
        if (stepOpen < 0) { problems.push({ kind: 'unbalanced-step-end', detail: 'step/end without step/start' }); stepOpen = 0; }
        break;
      case 'tool/call':
        if (e.meta && e.meta.callId) openCalls.add(e.meta.callId);
        break;
      case 'tool/result':
        if (e.meta && e.meta.callId) openCalls.delete(e.meta.callId);
        break;
      case 'compaction/start': compactOpen += 1; break;
      case 'compaction/end':
        compactOpen -= 1;
        if (compactOpen < 0) { problems.push({ kind: 'unbalanced-compaction-end', detail: 'compaction/end without start' }); compactOpen = 0; }
        break;
    }
  }
  if (turnOpen > 0) problems.push({ kind: 'unclosed-turn', detail: `${turnOpen} turn/start without turn/end (crash or in-flight)` });
  if (stepOpen > 0) problems.push({ kind: 'unclosed-step', detail: `${stepOpen} step/start without step/end` });
  if (compactOpen > 0) problems.push({ kind: 'unclosed-compaction', detail: 'compaction started but never ended (orphaned lock)' });
  if (openCalls.size) problems.push({ kind: 'unanswered-tool-call', detail: `${openCalls.size} tool/call(s) without a result` });

  return { ok: problems.length === 0, problems, events: events.length };
}

/** Aggregate invariant status across conversations (bounded). */
export function invariantStatus(limit = 50) {
  const { listConversations } = globalThis.__jexiSessionConversations || { listConversations: () => [] };
  let checked = 0;
  let failed = 0;
  try {
    const convs = listConversations ? listConversations() : [];
    for (const c of convs.slice(0, Math.max(1, Number(limit) || 50))) {
      checked += 1;
      const r = checkConversationInvariants(c.id);
      if (!r.ok) failed += 1;
    }
  } catch { /* best-effort */ }
  return { ok: failed === 0, checked, failed };
}

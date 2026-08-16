/**
 * JEXI OS — Session Store (Priority 5 & 9)
 * ----------------------------------------
 * Replaces the old module-level `pendingTask` singleton with a conversation-scoped
 * in-memory store, so concurrent chats from different users/sessions never race.
 *
 * Three kinds of per-conversation state live here:
 *   - OFFER  : the classic "I want to build X" → "yes?" → resume flow
 *              ({ at, query } — kept for backward compatibility).
 *   - RUN    : a FULL RunState captured at a graph `confirmationPause`
 *              (Priority 5) — the graph resumes at the exact paused node with
 *              prior intermediate results intact, never from the planner.
 *   - RESULT : the LAST completed run's final summary (Build 48, P5). When the
 *              NDJSON stream drops mid-task (proxy drop, backgrounded app, host
 *              restart) the server-side mission keeps running and this store
 *              captures its outcome, so the frontend can AUTO-RECOVER by
 *              polling /api/chat/result instead of telling the user to ask JEXI
 *              to continue.
 *
 * In-memory by design (single-instance deploy). If JEXI ever runs multi-instance,
 * swap the Maps for Redis with the same API — call that out in FIXLOG.md.
 */

const OFFER_TTL_MS = 15 * 60 * 1000; // matches the old RESUME_TTL_MS

/** @type {Map<string, { at: number, query: string }>} */
const offerSessions = new Map();

/** @type {Map<string, { at: number, plan: Object, query: string, state: Object }>} */
const runSessions = new Map();

export function saveOffer(convId, query) {
  if (!convId) return;
  offerSessions.set(convId, { at: Date.now(), query });
}

export function loadOffer(convId) {
  if (!convId) return null;
  const entry = offerSessions.get(convId);
  if (!entry) return null;
  if (Date.now() - entry.at > OFFER_TTL_MS) {
    offerSessions.delete(convId);
    return null;
  }
  return entry;
}

export function clearOffer(convId) {
  if (convId) offerSessions.delete(convId);
}

/** Persist a paused graph RunState keyed by conversation ID (P5). */
export function saveRun(convId, { plan, query, state }) {
  if (!convId) return;
  runSessions.set(convId, { at: Date.now(), plan, query, state });
}

export function loadRun(convId) {
  if (!convId) return null;
  const entry = runSessions.get(convId);
  if (!entry) return null;
  if (Date.now() - entry.at > OFFER_TTL_MS) {
    runSessions.delete(convId);
    return null;
  }
  return entry;
}

export function clearRun(convId) {
  if (convId) runSessions.delete(convId);
}

/** @type {Map<string, { at: number, result: Object }>} */
const resultSessions = new Map();

const RESULT_TTL_MS = 10 * 60 * 1000; // long enough for the frontend to poll back

/** Persist the last completed run's outcome (B48 P5 — dropped-stream recovery). */
export function saveResult(convId, result) {
  if (!convId) return;
  resultSessions.set(convId, { at: Date.now(), result });
}

export function loadResult(convId) {
  if (!convId) return null;
  const entry = resultSessions.get(convId);
  if (!entry) return null;
  if (Date.now() - entry.at > RESULT_TTL_MS) {
    resultSessions.delete(convId);
    return null;
  }
  return entry.result;
}

export function clearResult(convId) {
  if (convId) resultSessions.delete(convId);
}

/* ------------------------------------------------------------------ */
/* B48 P7.2 — dropped-connection / recovery observability.             */
/* Every recovery-path touchpoint records an event (cause, whether a   */
/* result was actually recovered) so the timeout/heartbeat fix can be  */
/* validated in practice, not just in synthetic tests.                 */
/* ------------------------------------------------------------------ */
const recoveryEvents = [];

/** Record a recovery touchpoint: a poll hit, a deadline fire, a resume. */
export function recordRecoveryEvent({ convId = '', cause = 'unknown', recovered = false, detail = '' } = {}) {
  recoveryEvents.push({
    at: Date.now(),
    convId: String(convId || '').slice(0, 80),
    cause: String(cause || 'unknown').slice(0, 40),
    recovered: Boolean(recovered),
    detail: String(detail || '').slice(0, 200),
  });
  if (recoveryEvents.length > 500) recoveryEvents.shift();
}

/** Current recovery observability stats (B48 P7.2). */
export function recoveryStats() {
  const byCause = {};
  for (const e of recoveryEvents) byCause[e.cause] = (byCause[e.cause] || 0) + 1;
  return {
    total: recoveryEvents.length,
    recovered: recoveryEvents.filter((e) => e.recovered).length,
    byCause,
    last: recoveryEvents.length ? { ...recoveryEvents[recoveryEvents.length - 1] } : null,
  };
}

/** Test/observability helpers. */
export function clearAllSessions() {
  offerSessions.clear();
  runSessions.clear();
  resultSessions.clear();
  recoveryEvents.length = 0;
  sessionRegistry.clear();
}

export function sessionCounts() {
  return { offers: offerSessions.size, runs: runSessions.size, results: resultSessions.size, sessions: sessionRegistry.size };
}

/* ------------------------------------------------------------------ */
/* Session registry — which conversations exist, when last active.     */
/* Drives /api/sessions so the UI can show/switch conversations and    */
/* prove that per-session history is never mixed.                      */
/* ------------------------------------------------------------------ */
const sessionRegistry = new Map(); // convId → { firstSeen, lastSeen, turns }

export function touchSession(convId) {
  if (!convId) return;
  const now = Date.now();
  const prev = sessionRegistry.get(convId);
  if (prev) {
    prev.lastSeen = now;
    prev.turns += 1;
  } else {
    sessionRegistry.set(convId, { firstSeen: now, lastSeen: now, turns: 1 });
  }
}

export function listSessions() {
  return [...sessionRegistry.entries()]
    .map(([id, s]) => ({ id, firstSeen: s.firstSeen, lastSeen: s.lastSeen, turns: s.turns }))
    .sort((a, b) => b.lastSeen - a.lastSeen)
    .slice(0, 100);
}

export function clearSession(convId) {
  if (!convId) return;
  sessionRegistry.delete(convId);
  offerSessions.delete(convId);
  runSessions.delete(convId);
  resultSessions.delete(convId);
}

/**
 * JEXI OS — Session Store (Priority 5 & 9)
 * ----------------------------------------
 * Replaces the old module-level `pendingTask` singleton with a conversation-scoped
 * in-memory store, so concurrent chats from different users/sessions never race.
 *
 * Two kinds of per-conversation state live here:
 *   - OFFER  : the classic "I want to build X" → "yes?" → resume flow
 *              ({ at, query } — kept for backward compatibility).
 *   - RUN    : a FULL RunState captured at a graph `confirmationPause`
 *              (Priority 5) — the graph resumes at the exact paused node with
 *              prior intermediate results intact, never from the planner.
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

/** Test/observability helpers. */
export function clearAllSessions() {
  offerSessions.clear();
  runSessions.clear();
}

export function sessionCounts() {
  return { offers: offerSessions.size, runs: runSessions.size };
}

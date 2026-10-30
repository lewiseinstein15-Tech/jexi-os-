/**
 * JEXI OS — Session Store (Priority 5 & 9; M10 durability).
 * ---------------------------------------------------------
 * Conversation-scoped state, so concurrent chats from different users/sessions
 * never race. Three kinds of per-conversation state live here:
 *
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
 * M10 — DURABLE: this store used to be in-memory only, so a process restart
 * erased the parked RunState, the offer and the last result. A paused task was
 * silently lost and its evidence with it. Every entry is now written through
 * `DurableStore` (atomic JSON under DATA_DIR/sessions/, Redis-mirrored) keyed
 * per session, so recovery after a restart is honest:
 *   - a parked approval is RESTORED but NEVER auto-approved;
 *   - an in-flight run whose process died is classified `interrupted` (outcome
 *     UNKNOWN) — never reported as done;
 *   - a completed run's result survives the restart.
 * `recoverSessionsOnBoot()` performs the classification at boot.
 *
 * The public API is unchanged (index.js is the only consumer) — the Maps are
 * replaced by the durable store, and the read helpers keep returning the same
 * shapes plus additive fields (`epoch`, `status`, `checkpointState`, `owner`).
 */

import { DurableStore, BOOT_EPOCH } from './DurableStore.js';
import {
  classifyRun, isResumable, resumeSafety, recoveryNote, projectRunState,
  RECOVERY_STATES,
} from './ChatRecovery.js';

const OFFER_TTL_MS = 15 * 60 * 1000; // matches the old RESUME_TTL_MS
const RESULT_TTL_MS = 40 * 60 * 1000; // B105 — results must outlive the client's recovery window (30min)

const store = new DurableStore();

/** Test seam: redirect the durable store to a temp dir. */
export function __setSessionsDir(dir) { store._dirOverride = dir ? String(dir) : null; }
export function __resetSessionsDir() { store._dirOverride = null; }

const offerKey = (convId) => `offer::${convId}`;
const runKey = (convId) => `run::${convId}`;
const resultKey = (convId) => `result::${convId}`;

/** In-process claim set: guarantees a single live worker per conversation
 *  within this process, independent of the durable owner stamp. */
const liveClaims = new Map(); // convId → workerId

/* ── OFFER ───────────────────────────────────────────────────────────── */

export function saveOffer(convId, query) {
  if (!convId) return;
  store.save(offerKey(convId), { at: Date.now(), query });
}

export function loadOffer(convId) {
  if (!convId) return null;
  const res = store.load(offerKey(convId));
  if (!res.found) return null;
  const entry = res.value;
  if (!entry || typeof entry.at !== 'number') return null;
  if (Date.now() - entry.at > OFFER_TTL_MS) { store.remove(offerKey(convId)); return null; }
  return entry;
}

export function clearOffer(convId) {
  if (convId) store.remove(offerKey(convId));
}

/* ── RUN (parked graph RunState) ─────────────────────────────────────── */

/**
 * Derive the honest checkpoint classification for a paused RunState.
 *  - a pending confirmation → 'awaiting_approval' (parked BEFORE the action)
 *  - any other pause        → 'awaiting_verification'
 *  - otherwise              → 'running'
 */
function checkpointStateOf(state) {
  if (state && typeof state === 'object') {
    const payload = state.confirmationPayload;
    if (state.needsConfirmation || (payload && !payload.resolved)) return 'awaiting_approval';
    if (state.status === 'paused') return 'awaiting_verification';
  }
  return 'running';
}

/**
 * Persist a paused graph RunState keyed by conversation ID (P5).
 * `state` is projected to a JSON-safe form (functions dropped, cycles broken,
 * brainContext stripped) so it round-trips exactly on resume.
 */
export function saveRun(convId, { plan, query, state }) {
  if (!convId) return;
  const entry = {
    at: Date.now(),
    plan,
    query,
    state: projectRunState(state),
    epoch: BOOT_EPOCH,                    // the process that parked this run
    status: 'paused',
    checkpointState: checkpointStateOf(state),
    owner: null,                          // set by claimRun
  };
  store.save(runKey(convId), entry);
}

export function loadRun(convId) {
  if (!convId) return null;
  const res = store.load(runKey(convId));
  if (!res.found) return null;
  const entry = res.value;
  if (!entry || typeof entry.at !== 'number') return null;
  if (Date.now() - entry.at > OFFER_TTL_MS) { store.remove(runKey(convId)); return null; }
  return entry;
}

export function clearRun(convId) {
  if (convId) { store.remove(runKey(convId)); liveClaims.delete(convId); }
}

/**
 * Claim a parked run for a worker so two workers never resume it at once.
 * A claim held by a DIFFERENT worker in THIS process is refused. A claim left
 * by a PREVIOUS process (ownerEpoch ≠ this boot) is stale and reclaimable.
 * @returns {{ok:boolean, reason?:string, owner?:string}}
 */
export function claimRun(convId, workerId) {
  if (!convId || !workerId) return { ok: false, reason: 'bad_args' };
  const live = liveClaims.get(convId);
  if (live && live !== workerId) return { ok: false, reason: 'already_claimed', owner: live };
  const res = store.load(runKey(convId));
  if (!res.found) return { ok: false, reason: 'no_run' };
  const entry = res.value;
  if (entry.owner && entry.owner !== workerId && entry.ownerEpoch === BOOT_EPOCH) {
    return { ok: false, reason: 'already_claimed', owner: entry.owner };
  }
  liveClaims.set(convId, workerId);
  entry.owner = workerId;
  entry.ownerEpoch = BOOT_EPOCH;
  store.save(runKey(convId), entry);
  return { ok: true, owner: workerId };
}

export function releaseRun(convId, workerId) {
  if (!convId) return;
  if (!workerId || liveClaims.get(convId) === workerId) liveClaims.delete(convId);
  const res = store.load(runKey(convId));
  if (res.found && res.value && (!workerId || res.value.owner === workerId)) {
    res.value.owner = null;
    res.value.ownerEpoch = null;
    store.save(runKey(convId), res.value);
  }
}

/* ── RESULT ──────────────────────────────────────────────────────────── */

/** Persist the last completed run's outcome (B48 P5 — dropped-stream recovery). */
export function saveResult(convId, result) {
  if (!convId) return;
  store.save(resultKey(convId), { at: Date.now(), result });
}

export function loadResult(convId) {
  if (!convId) return null;
  const res = store.load(resultKey(convId));
  if (!res.found) return null;
  const entry = res.value;
  if (!entry || typeof entry.at !== 'number') return null;
  if (Date.now() - entry.at > RESULT_TTL_MS) { store.remove(resultKey(convId)); return null; }
  return entry.result;
}

export function clearResult(convId) {
  if (convId) store.remove(resultKey(convId));
}

/* ── boot recovery ───────────────────────────────────────────────────── */

/**
 * Classify every persisted RUN at boot and report honestly. NEVER auto-approves
 * a parked run and NEVER marks an interrupted run as done.
 * @returns {{scanned:number, awaitingApproval:string[], awaitingVerification:string[],
 *            interrupted:string[], completed:number, failed:number, cancelled:number,
 *            corrupt:string[], records:Array<object>}}
 */
export function recoverSessionsOnBoot() {
  const summary = {
    scanned: 0, awaitingApproval: [], awaitingVerification: [], interrupted: [],
    completed: 0, failed: 0, cancelled: 0, corrupt: [], records: [],
  };
  for (const key of store.keys()) {
    if (!key.startsWith('run::')) continue;
    const convId = key.slice('run::'.length);
    const res = store.load(key);
    summary.scanned += 1;
    if (res.corrupt) summary.corrupt.push(convId);
    const state = classifyRun(res.value, { bootEpoch: BOOT_EPOCH });
    const note = recoveryNote(res.value, state, { bootEpoch: BOOT_EPOCH });
    summary.records.push({
      conversationId: convId, state, note,
      safety: resumeSafety(res.value, { bootEpoch: BOOT_EPOCH }),
      resumable: isResumable(res.value, { bootEpoch: BOOT_EPOCH }),
      corrupt: Boolean(res.corrupt),
    });
    if (state === RECOVERY_STATES.AWAITING_APPROVAL) summary.awaitingApproval.push(convId);
    else if (state === RECOVERY_STATES.AWAITING_VERIFICATION) summary.awaitingVerification.push(convId);
    else if (state === RECOVERY_STATES.INTERRUPTED) summary.interrupted.push(convId);
    else if (state === RECOVERY_STATES.COMPLETED) summary.completed += 1;
    else if (state === RECOVERY_STATES.FAILED) summary.failed += 1;
    else if (state === RECOVERY_STATES.CANCELLED) summary.cancelled += 1;
    recordRecoveryEvent({
      convId, cause: `boot:${state}`,
      recovered: state === RECOVERY_STATES.COMPLETED,
      detail: note.slice(0, 180),
    });
  }
  return summary;
}

/* ── dropped-connection / recovery observability (B48 P7.2) ───────────── */

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
  store.clear();
  liveClaims.clear();
  recoveryEvents.length = 0;
  sessionRegistry.clear();
}

export function sessionCounts() {
  const keys = store.keys();
  return {
    offers: keys.filter((k) => k.startsWith('offer::')).length,
    runs: keys.filter((k) => k.startsWith('run::')).length,
    results: keys.filter((k) => k.startsWith('result::')).length,
    sessions: sessionRegistry.size,
  };
}

/* ── session registry — which conversations exist, when last active. ──── */

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
  clearOffer(convId);
  clearRun(convId);
  clearResult(convId);
}

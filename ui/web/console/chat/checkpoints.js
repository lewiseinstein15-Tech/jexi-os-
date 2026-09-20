/**
 * JEXI OS — Phase 16 Scope N — Chat Checkpoints
 *
 * A checkpoint marks a replayable point in a session: the routed event log up
 * to and including the current turn's turn.completed, the Scope H modes at that
 * moment, and the queue/steer item ids present then. From a checkpoint the user
 * can (a) RESTORE — dropping every routed event and every queue item added after
 * it — or (b) BRANCH — creating a NEW session that starts from the checkpoint's
 * event log while the source session is preserved byte-identical.
 *
 * Real-truncation constraint (flagged in the report): Scope I's router and
 * Scope J's runtime expose NO per-session history-truncation API (only a global
 * _reset), and both are out of zone. So restore is realised as:
 *   - a per-session DISCARDED offset that shrinks the effective event count
 *     (the checkpoint surface's view of the log), and
 *   - REAL mutations that ARE available: queue.cancel() for every queue item
 *     added after the checkpoint, and modes.setDisplayMode/setInteractionMode
 *     to put Scope H back to the captured state.
 * Branch is fully real: the frozen event copies captured at create() are
 * re-routed (with sessionId rewritten) into a fresh attached session, so the
 * branch's router history equals the checkpoint log and the source is untouched.
 *
 * Restore/branch surface events are emitted as VALID narration.line events with
 * a structured ctx ({checkpoint:'restored'|'branched', ...}); the taxonomy has no
 * checkpoint.* type (gap reported; Scope A NOT edited).
 */

import { runtime } from './runtime.js';
import { router } from './router.js';
import { modes } from './modes.js';
import { queue } from './queue.js';
import { steer } from './steer.js';

const TS_BASE = 1767225600000;
const TERMINAL = new Set(['done', 'failed']);

function fail(code, message) {
  const err = new Error(message || code);
  err.code = code;
  return err;
}

let tsSeq = 0;

/** sessionId -> { seq, discarded, checkpoints: [] } */
const sessions = new Map();

function sess(sessionId) {
  if (!sessions.has(sessionId)) sessions.set(sessionId, { seq: 0, discarded: 0, checkpoints: [] });
  return sessions.get(sessionId);
}

function assertSession(sessionId) {
  if (typeof sessionId !== 'string' || !sessionId) throw fail('E_UNKNOWN_SESSION', 'sessionId required');
  if (!runtime.isAttached(sessionId)) throw fail('E_UNKNOWN_SESSION', `unknown session: ${sessionId}`);
}

function assertCheckpoint(sessionId, checkpointId) {
  const cp = sess(sessionId).checkpoints.find((c) => c.checkpointId === checkpointId);
  if (!cp) throw fail('E_UNKNOWN_CHECKPOINT', `unknown checkpoint: ${checkpointId}`);
  return cp;
}

/** Effective routed-event count for a session (router length minus discarded). */
function effLen(sessionId) {
  return router.history(sessionId).length - sess(sessionId).discarded;
}

function isTurnActive(sessionId) {
  const st = runtime.state(sessionId);
  return !!(st.turnId && !TERMINAL.has(st.status) && st.status !== 'idle');
}

function emitCheckpoint(sessionId, phase, ctx, turnId) {
  tsSeq += 1;
  const evt = {
    type: 'narration.line',
    version: 1,
    ts: TS_BASE + tsSeq,
    sessionId,
    agentId: 'agent-runtime',
    payload: {
      narrationType: 'decision',
      text: phase === 'restored' ? `restored to ${ctx.checkpointId}, discarded ${ctx.discarded} events`
        : `branched ${ctx.newSessionId} from ${ctx.checkpointId}`,
      ctx: { checkpoint: phase, ...ctx, turnId: turnId ?? null },
      ...(turnId ? { turnId } : {}),
    },
  };
  return router.route(sessionId, evt);
}

/**
 * @param {string} sessionId
 * @param {string} [label]
 */
export function create(sessionId, label) {
  assertSession(sessionId);
  const s = sess(sessionId);
  s.seq += 1;
  const st = runtime.state(sessionId);
  const cp = {
    checkpointId: `${sessionId}:ck-${s.seq}`,
    sessionId,
    turnId: st.turnId ?? null,
    label: typeof label === 'string' ? label : null,
    eventCount: effLen(sessionId),
    modes: { ...modes.get(sessionId) },
    queueIds: queue.list(sessionId).map((q) => q.queueId),
    steerIds: steer.pending(sessionId).map((x) => x.steerId),
    events: router.history(sessionId).slice(0, effLen(sessionId)).map((r) => ({ ...r.event })),
    createdAt: TS_BASE + (++tsSeq),
  };
  s.checkpoints.push(cp);
  return publicCheckpoint(cp);
}

function publicCheckpoint(cp) {
  return {
    checkpointId: cp.checkpointId,
    sessionId: cp.sessionId,
    turnId: cp.turnId,
    label: cp.label,
    eventCount: cp.eventCount,
    modes: { ...cp.modes },
    createdAt: cp.createdAt,
  };
}

export function list(sessionId) {
  assertSession(sessionId);
  return sess(sessionId).checkpoints.map((cp) => ({
    checkpointId: cp.checkpointId,
    turnId: cp.turnId,
    label: cp.label,
    eventCount: cp.eventCount,
    createdAt: cp.createdAt,
  }));
}

export function preview(checkpointId) {
  // find the session owning this checkpoint
  const sessionId = sessionIdFor(checkpointId);
  assertSession(sessionId);
  const cp = assertCheckpoint(sessionId, checkpointId);
  const currentQueue = queue.list(sessionId).map((q) => q.queueId);
  const currentSteer = steer.pending(sessionId).map((x) => x.steerId);
  return {
    checkpointId,
    willRestore: cp.eventCount,
    willDiscard: effLen(sessionId) - cp.eventCount,
    modes: { ...cp.modes },
    pending: {
      queue: currentQueue.filter((id) => !cp.queueIds.includes(id)).length,
      steer: currentSteer.filter((id) => !cp.steerIds.includes(id)).length,
    },
  };
}

function sessionIdFor(checkpointId) {
  for (const [id, s] of sessions) if (s.checkpoints.some((c) => c.checkpointId === checkpointId)) return id;
  throw fail('E_UNKNOWN_CHECKPOINT', `unknown checkpoint: ${checkpointId}`);
}

/**
 * @param {string} sessionId
 * @param {string} checkpointId
 * @param {{ confirm?: boolean }} [opts]
 */
export function restore(sessionId, checkpointId, opts = {}) {
  assertSession(sessionId);
  const cp = assertCheckpoint(sessionId, checkpointId);
  if (isTurnActive(sessionId)) throw fail('E_TURN_ACTIVE', 'cannot restore while a turn is streaming');
  if (cp.eventCount === 0 && !(opts && opts.confirm === true)) {
    throw fail('E_CONFIRM_REQUIRED', 'restoring to event 0 wipes the session; pass confirm:true');
  }

  const s = sess(sessionId);
  const discard = effLen(sessionId) - cp.eventCount;
  s.discarded += Math.max(0, discard);

  // Real queue truncation: cancel items added after the checkpoint.
  for (const id of queue.list(sessionId).map((q) => q.queueId)) {
    if (!cp.queueIds.includes(id)) { try { queue.cancel(sessionId, id); } catch { /* already gone */ } }
  }

  // Real modes restore (Scope H).
  modes.setDisplayMode(sessionId, cp.modes.displayMode);
  modes.setInteractionMode(sessionId, cp.modes.interactionMode);

  emitCheckpoint(sessionId, 'restored', { checkpointId, discarded: discard }, cp.turnId);
  return { restored: true, sessionId, atTurnId: cp.turnId };
}

/**
 * @param {string} sessionId source session (unchanged)
 * @param {string} checkpointId
 * @param {string} [newSessionId]
 */
export function branch(sessionId, checkpointId, newSessionId) {
  assertSession(sessionId);
  const cp = assertCheckpoint(sessionId, checkpointId);
  // Branch is allowed even while the source turn streams — source is unaffected.
  const target = typeof newSessionId === 'string' && newSessionId ? newSessionId : `${sessionId}-b${sess(sessionId).seq}`;

  runtime.attach(target);
  modes.setDisplayMode(target, cp.modes.displayMode);
  modes.setInteractionMode(target, cp.modes.interactionMode);
  // Replay the frozen checkpoint log into the new session (sessionId rewritten).
  for (const ev of cp.events) {
    router.route(target, { ...ev, sessionId: target });
  }
  sess(target); // register branch session in the checkpoint store

  emitCheckpoint(sessionId, 'branched', { checkpointId, newSessionId: target }, cp.turnId);
  return { newSessionId: target, branchFromTurnId: cp.turnId };
}

/** Read-only effective routed-event count (router length minus discarded). */
export function effCount(sessionId) {
  assertSession(sessionId);
  return effLen(sessionId);
}

export function _reset() {
  sessions.clear();
  tsSeq = 0;
}

export const checkpoints = { create, list, preview, restore, branch, effCount, _reset };
export default checkpoints;

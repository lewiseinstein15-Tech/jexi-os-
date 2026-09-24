/**
 * JEXI OS — Phase 16 Scope M — Queue (hold + auto-start next turn)
 *
 * QUEUE holds a user message sent while a turn is streaming and auto-starts it
 * (through runtime.send, as a NEW turn) the moment the active turn reaches a
 * terminal status. Per-session, FIFO, order-preserving.
 *
 *  - enqueue while the turn is active  -> held, position = index in the FIFO.
 *  - enqueue while idle                -> dispatched immediately (no hold).
 *  - On each turn.completed, a per-session router watcher (Scope I) schedules a
 *    flush on a microtask, which shifts the next queued message and starts it.
 *    This chains queued messages one turn at a time, preserving Scope J's
 *    one-active-turn contract.
 *  - Queue survives session detach: state lives in this module keyed by
 *    sessionId, not inside the runtime handle (Scope J's session-scoped
 *    recorder pattern).
 *
 * Bounds: QUEUE_BOUND (32) pending items per session; overflow -> E_QUEUE_FULL.
 * cancel of an unknown id -> E_UNKNOWN_QUEUE_ITEM; of an already-started id ->
 * E_ALREADY_STARTED.
 *
 * Taxonomy gap (Scope A is read-only): queue.enqueued / queue.started /
 * queue.cancelled are emitted as VALID narration.line events (narrationType
 * 'progress') carrying a structured ctx (ctx.queue = 'enqueued'|'started'|
 * 'cancelled'). Reported in the Scope M report; Scope A is NOT edited.
 */

import { runtime } from './runtime.js';
import { router } from './router.js';
import { steer } from './steer.js';

export const QUEUE_BOUND = 32;
const TS_BASE = 1767225600000;
const TERMINAL = new Set(['done', 'failed']);

function fail(code, message) {
  const err = new Error(message || code);
  err.code = code;
  return err;
}

let tsSeq = 0;

/** sessionId -> { items: [], started: Map, seq, watcher } */
const sessions = new Map();
/** sessionId -> base agent factory used when auto-flushing */
const baseAgents = new Map();

function sess(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, { items: [], started: new Map(), seq: 0, watcher: null });
  }
  return sessions.get(sessionId);
}

function emitQueue(sessionId, phase, item, turnId) {
  tsSeq += 1;
  const evt = {
    type: 'narration.line',
    version: 1,
    ts: TS_BASE + tsSeq,
    sessionId,
    agentId: 'agent-runtime',
    payload: {
      narrationType: 'progress',
      text: phase === 'enqueued' ? `queued (#${item.position}): ${item.message}`
        : phase === 'started' ? `queue started: ${item.message}`
          : `queue cancelled: ${item.message}`,
      ctx: { queue: phase, queueId: item.queueId, position: item.position ?? null, turnId: turnId ?? null },
      ...(turnId ? { turnId } : {}),
    },
  };
  return router.route(sessionId, evt);
}

function isTurnActive(sessionId) {
  const st = runtime.state(sessionId);
  return !!(st.turnId && !TERMINAL.has(st.status) && st.status !== 'idle');
}

/** Dispatch a message as a fresh turn through runtime.send with a steered agent. */
function dispatch(sessionId, message, item) {
  const base = baseAgents.get(sessionId);
  const agent = base ? steer.wrapAgent(base) : undefined;
  const { turnId } = runtime.send(sessionId, message, agent ? { agent } : undefined);
  item.startedAt = turnId;
  sess(sessionId).started.set(item.queueId, turnId);
  emitQueue(sessionId, 'started', { ...item, position: undefined }, turnId);
  return turnId;
}

/** Watch for terminal turn events and auto-flush on a microtask. */
function ensureWatcher(sessionId) {
  const s = sess(sessionId);
  if (s.watcher) return;
  s.watcher = router.subscribe(sessionId, (rec) => {
    // Router envelopes carry the type on .event, not at the top level.
    if (rec && rec.event && rec.event.type === 'turn.completed') {
      queueMicrotask(() => { try { flush(sessionId); } catch { /* never kill the router on flush error */ } });
    }
  });
}

/**
 * @param {string} sessionId
 * @param {string} message
 * @param {{ agent?: Function }} [opts] base agent factory for this session's turns
 * @returns {{ queueId: string, position: number, started?: boolean }}
 */
export function enqueue(sessionId, message, opts = {}) {
  if (typeof message !== 'string' || !message) throw fail('E_INVALID_INPUT', 'queue message required');
  if (opts && typeof opts.agent === 'function') baseAgents.set(sessionId, opts.agent);
  ensureWatcher(sessionId);

  const s = sess(sessionId);
  s.seq += 1;
  const queueId = `${sessionId}:q-${s.seq}`;

  if (!isTurnActive(sessionId)) {
    const item = { queueId, message, position: 0 };
    const turnId = dispatch(sessionId, message, item);
    return { queueId, position: 0, started: true, turnId };
  }

  if (s.items.length >= QUEUE_BOUND) throw fail('E_QUEUE_FULL', `queue bound ${QUEUE_BOUND} reached for ${sessionId}`);
  const item = { queueId, message, position: s.items.length + 1 };
  s.items.push(item);
  emitQueue(sessionId, 'enqueued', item);
  return { queueId, position: item.position };
}

/** FIFO list of pending (not started, not cancelled) items, positions 1..N. */
export function list(sessionId) {
  return sess(sessionId).items.map((it, i) => ({ queueId: it.queueId, message: it.message, position: i + 1 }));
}

export function cancel(sessionId, queueId) {
  const s = sess(sessionId);
  if (s.started.has(queueId)) throw fail('E_ALREADY_STARTED', `${queueId} already started`);
  const idx = s.items.findIndex((it) => it.queueId === queueId);
  if (idx < 0) throw fail('E_UNKNOWN_QUEUE_ITEM', `unknown queue item: ${queueId}`);
  const [item] = s.items.splice(idx, 1);
  emitQueue(sessionId, 'cancelled', item);
  return { cancelled: true, queueId };
}

/** Start the next queued message if the turn is idle; no-op if a turn is active. */
export function flush(sessionId) {
  const s = sess(sessionId);
  if (isTurnActive(sessionId)) return { started: false, reason: 'turn active' };
  const item = s.items.shift();
  if (!item) return { started: false, reason: 'queue empty' };
  const turnId = dispatch(sessionId, item.message, item);
  return { started: true, queueId: item.queueId, turnId };
}

export function _reset() {
  for (const s of sessions.values()) { if (s.watcher) { s.watcher(); } }
  sessions.clear();
  baseAgents.clear();
  tsSeq = 0;
}

export const queue = { enqueue, list, cancel, flush, _reset, QUEUE_BOUND };
export default queue;

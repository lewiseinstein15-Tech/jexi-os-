/**
 * JEXI OS — Phase 16 Scope I — Event Router
 *
 * The missing seam between "agent emits typed events" (Scope A) and "chat
 * surfaces render them" (Scopes B/C/D/E/G) with the session's modes (Scope H)
 * applied in between. Before this, every renderer had to find its own events.
 * The router is the single dispatch point: it validates every event against
 * the Scope A taxonomy, applies modes.apply(), then routes to every surface
 * that can claim the event — in order, once each, nothing dropped silently.
 *
 * Contract:
 *  router.subscribe(sessionId, handler) -> unsubscribe fn
 *    handler(envelope) called ONCE per routed event, in receipt order.
 *  router.route(sessionId, event) -> {
 *    routed: boolean,
 *    surfaces: ['rows'|'draft'|'dual-pane'|'approval'|'narration'],
 *    event,      // the pristine Scope A event (see NOTE below)
 *    turnId, seq,
 *    modes?,     // Scope H verdict that shaped the delivery
 *    reason?     // when routed:false
 *  }
 *  router.drain(sessionId)  -> { drained, envelopes }
 *  router.history(sessionId, limit?) -> routed AND dropped entries, in order
 *
 * NOTE ON "event possibly shaped by modes.apply()":
 *  The router never mutates the event bytes. Scope A's validate() rejects any
 *  extra top-level field with E_EXTRA_FIELD, so writing a modes verdict onto
 *  the event would make a previously-valid event invalid — the two rules in
 *  this spec cannot both hold if the event object itself is rewritten. So
 *  modes.apply() shapes the DELIVERY (gating + rowOverride), and the verdict
 *  travels beside the event in `modes` / on the envelope. The event stays
 *  byte-identical to what the agent emitted, which is also what makes P8's
 *  byte-equality meaningful.
 *
 * Surfaces are dispatched for real, through the real scope modules:
 *  rows       -> rows.render(event)          (Scope C, pure)
 *  dual-pane  -> dualPane.split([event])     (Scope E, pure)
 *  narration  -> narration.list() membership (Scope B, pure)
 *  draft      -> eligibility + turn-active tracking (Scope D)
 *  approval   -> approval-type delivery      (Scope G)
 * Scope D's create/update/finalize are a throttled stateful turn API owned by
 * the turn lifecycle; the router delivers to draft but does not drive that
 * state machine blindly (it would trip E_DRAFT_ACTIVE / E_DRAFT_FINALIZED).
 *
 * Rules implemented:
 *  - taxonomy.validate() gates everything; invalid -> E_INVALID_EVENT, unknown
 *    type -> E_UNMAPPED_EVENT. Both are returned AND recorded in history.
 *  - Modes apply BEFORE surface dispatch. A plan-mode write-class tool event
 *    still routes (routed:true) — surfaces see allowed:false + the named
 *    reason. Refused, never dropped.
 *  - No "first match wins": every claiming surface gets the event.
 *  - Order preserved per session via a monotonic seq.
 *  - Lazy session creation on subscribe and on route.
 *  - Handler throws are isolated: other handlers still receive the event, the
 *    thrower is disabled and logged. No cascade.
 *  - Events routed with no subscriber present are queued; drain() flushes them
 *    in order. A queued envelope dispatches at most once.
 *  - Deterministic: no clock and no randomness on the routing path.
 */

import { taxonomy } from '../../../../../runtime/events/chat/taxonomy.js';
import { rows } from './rows/index.js';
import { dualPane } from './dual-pane.js';
import { narration } from '../../../../../agents/workforce/narration/index.js';
import { modes as modesScope } from './modes.js';

export const SURFACES = ['rows', 'draft', 'dual-pane', 'approval', 'narration'];

const NARRATION_TYPES = new Set(narration.list());

/** Event type -> every surface that can claim it. No first-match-wins. */
const ROUTING_TABLE = {
  'message.delta':      ['rows', 'draft', 'dual-pane'],
  'thinking.delta':     ['rows', 'draft', 'dual-pane'],
  'plan.created':       ['rows', 'dual-pane'],
  'plan.updated':       ['rows', 'draft', 'dual-pane'],
  'tool.started':       ['rows', 'draft', 'dual-pane'],
  'tool.progress':      ['rows', 'draft', 'dual-pane'],
  'tool.completed':     ['rows', 'draft', 'dual-pane'],
  'tool.failed':        ['rows', 'draft', 'dual-pane'],
  'approval.requested': ['rows', 'dual-pane', 'approval'],
  'approval.resolved':  ['rows', 'dual-pane', 'approval'],
  'artifact.created':   ['rows', 'dual-pane'],
  'agent.spawned':      ['rows', 'dual-pane'],
  'agent.completed':    ['rows', 'dual-pane'],
  'turn.completed':     ['rows', 'draft', 'dual-pane'],
  'checkpoint.created': ['rows', 'dual-pane'],
  'narration.line':     ['rows', 'draft', 'dual-pane', 'narration'],
};

const TOOL_EVENT_TYPES = new Set(['tool.started', 'tool.progress', 'tool.completed', 'tool.failed']);

function fail(code, message) {
  const err = new Error(message || code);
  err.code = code;
  return err;
}

function assertSessionId(sessionId) {
  if (typeof sessionId !== 'string' || !taxonomy.SESSION_ID_RE.test(sessionId)) {
    throw fail('E_INVALID_SESSION', `Invalid sessionId: ${JSON.stringify(sessionId)}`);
  }
}

/* ------------------------------------------------------------------ *
 * Per-session state. Created lazily by both subscribe() and route().
 * ------------------------------------------------------------------ */

const sessions = new Map(); // sessionId -> session record

function sessionFor(sessionId) {
  let s = sessions.get(sessionId);
  if (!s) {
    s = {
      sessionId,
      seq: 0,             // monotonic receipt counter — order per session
      turnSeq: 1,         // derived turn counter, used when payload.turnId absent
      currentTurnId: null,
      closedTurns: new Set(), // turns that have completed — never reopened
      subscribers: [],    // [{ id, handler, disabled, throws }]
      queue: [],          // envelopes awaiting a subscriber
      history: [],        // routed AND dropped entries
      stats: { rows: 0, draft: 0, 'dual-pane': 0, approval: 0, narration: 0 },
      handlerLog: [],     // isolated handler failures
    };
    sessions.set(sessionId, s);
  }
  return s;
}

/**
 * Resolve the turn an event belongs to.
 * Prefers payload.turnId — the same convention Scope E's split() reads — and
 * otherwise derives one from a per-session counter that advances on
 * turn.completed. Deterministic for a given event sequence.
 */
function resolveTurnId(s, event) {
  const p = event.payload || {};
  if (typeof p.turnId === 'string' && p.turnId) {
    // A late event for an already-closed turn is routed under that id, but it
    // must NOT become the session's current turn — otherwise the next derived
    // event would inherit a closed turnId and lose its draft.
    if (!s.closedTurns.has(p.turnId)) s.currentTurnId = p.turnId;
    return p.turnId;
  }
  if (s.currentTurnId === null || s.closedTurns.has(s.currentTurnId)) {
    // Skip any id already closed, so a fresh turn never collides with one.
    while (s.closedTurns.has(`${s.sessionId}:t${s.turnSeq}`)) s.turnSeq += 1;
    s.currentTurnId = `${s.sessionId}:t${s.turnSeq}`;
  }
  return s.currentTurnId;
}

function closeTurn(s, turnId, inFlightTurnId) {
  s.closedTurns.add(turnId);
  // The completing event may name a turnId that differs from the derived one
  // in flight (payload.turnId vs `<session>:t<n>`). Close both, otherwise the
  // derived turn is never marked complete and a late event for it would
  // wrongly find a live draft. inFlightTurnId is captured BEFORE resolveTurnId
  // overwrites currentTurnId.
  if (inFlightTurnId !== null && inFlightTurnId !== turnId) s.closedTurns.add(inFlightTurnId);
  s.currentTurnId = null;
  s.turnSeq += 1;
}

/**
 * A draft is live for a turn from its first event until that turn completes.
 * A completed turn is never reopened, so a late event for it does not claim
 * the draft surface. turn.completed itself still reaches draft as the
 * finalize signal.
 */
function draftIsActive(s, turnId, eventType) {
  if (eventType === 'turn.completed') return true;
  return !s.closedTurns.has(turnId);
}

/* ------------------------------------------------------------------ *
 * Surface adapters — real dispatch into the real scope modules.
 * ------------------------------------------------------------------ */

function dispatchSurface(surface, envelope) {
  const { event, turnId } = envelope;

  switch (surface) {
    case 'rows': {
      // Scope C render, plus the Scope H verbosity projection beside it.
      const rendered = rows.render(event);
      return { surface, ok: true, rowType: rendered.rowType, content: rendered.content, rowOverride: envelope.modes.rowOverride ?? null };
    }
    case 'dual-pane': {
      const { processEvents, resultEvents } = dualPane.split([event]);
      return {
        surface,
        ok: true,
        pane: processEvents.length ? 'process' : 'result',
        processCount: processEvents.length,
        resultCount: resultEvents.length,
      };
    }
    case 'narration': {
      const nt = event.payload && event.payload.narrationType;
      return { surface, ok: true, narrationType: nt, known: NARRATION_TYPES.has(nt) };
    }
    case 'draft': {
      return { surface, ok: true, turnId, finalizes: event.type === 'turn.completed' };
    }
    case 'approval': {
      return { surface, ok: true, kind: event.type === 'approval.requested' ? 'requested' : 'resolved' };
    }
    default:
      throw fail('E_UNKNOWN_SURFACE', `Unknown surface: ${surface}`);
  }
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

export function subscribe(sessionId, handler) {
  assertSessionId(sessionId);
  if (typeof handler !== 'function') {
    throw fail('E_INVALID_HANDLER', 'handler must be a function');
  }
  const s = sessionFor(sessionId);
  const entry = { id: `sub_${s.subscribers.length + 1}`, handler, disabled: false, throws: 0 };
  s.subscribers.push(entry);

  let unsubscribed = false;
  return function unsubscribe() {
    if (unsubscribed) return false;
    unsubscribed = true;
    const i = s.subscribers.indexOf(entry);
    if (i >= 0) s.subscribers.splice(i, 1);
    return true;
  };
}

export function route(sessionId, event) {
  assertSessionId(sessionId);
  const s = sessionFor(sessionId);
  s.seq += 1;
  const seq = s.seq;

  /* ---- 1. Scope A validation gates everything ------------------- */
  const verdict = taxonomy.validate(event);
  if (!verdict.valid) {
    const codes = (verdict.errors || []).map((e) => e.code);
    // An unknown TYPE is a routing gap, not merely a malformed event.
    const reason = codes.includes('E_UNKNOWN_TYPE') ? 'E_UNMAPPED_EVENT' : 'E_INVALID_EVENT';
    const dropped = {
      seq,
      sessionId,
      type: (event && typeof event === 'object' && typeof event.type === 'string') ? event.type : null,
      routed: false,
      reason,
      errors: (verdict.errors || []).map((e) => ({ ...e })),
      surfaces: [],
      event: safeCopy(event),
    };
    s.history.push(dropped);
    return {
      routed: false,
      surfaces: [],
      event: safeCopy(event),
      seq,
      reason,
      errors: dropped.errors,
    };
  }

  /* ---- 2. Surface claim; an unmapped-but-valid type is a gap ---- */
  const claimed = ROUTING_TABLE[event.type];
  if (!claimed || claimed.length === 0) {
    const gap = {
      seq, sessionId, type: event.type, routed: false,
      reason: 'E_UNMAPPED_EVENT',
      errors: [{ code: 'E_UNMAPPED_SURFACE', message: `no surface claims type: ${event.type}`, field: 'type' }],
      surfaces: [], event: safeCopy(event),
    };
    s.history.push(gap);
    return { routed: false, surfaces: [], event: safeCopy(event), seq, reason: 'E_UNMAPPED_EVENT', errors: gap.errors };
  }

  /* ---- 3. Modes apply BEFORE dispatch (Scope H) ----------------- */
  // Captured before resolveTurnId, which overwrites currentTurnId when the
  // event carries its own payload.turnId.
  const inFlightTurnId = s.currentTurnId;
  const turnId = resolveTurnId(s, event);
  const modeVerdict = modesScope.apply(turnId, event);

  if (event.type === 'turn.completed') closeTurn(s, turnId, inFlightTurnId);

  const isToolEvent = TOOL_EVENT_TYPES.has(event.type);
  const modesView = {
    allowed: modeVerdict.allowed,
    reason: modeVerdict.reason ?? null,
    rowOverride: modeVerdict.rowOverride ?? null,
    displayMode: modeVerdict.displayMode,
    interactionMode: modeVerdict.interactionMode,
    // Only tool events carry a tool classification.
    classification: isToolEvent ? modeVerdict.classification : 'n/a',
  };

  /* ---- 4. Real dispatch to every claiming surface, once each ---- */
  const surfaceList = [...new Set(claimed)]; // dedupe: at most once per cycle
  const deliveries = [];
  for (const surface of surfaceList) {
    if (surface === 'draft' && !draftIsActive(s, turnId, event.type)) continue;
    let receipt;
    try {
      receipt = dispatchSurface(surface, { event, turnId, modes: modesView });
    } catch (e) {
      receipt = { surface, ok: false, error: e && e.code ? e.code : 'E_SURFACE_ERROR', message: String((e && e.message) || e) };
    }
    deliveries.push(receipt);
    s.stats[surface] = (s.stats[surface] || 0) + 1;
  }

  const dispatchedSurfaces = deliveries.filter((d) => d.ok).map((d) => d.surface);

  const envelope = Object.freeze({
    seq,
    sessionId,
    turnId,
    event: safeCopy(event),
    surfaces: dispatchedSurfaces,
    deliveries,
    modes: modesView,
    // A plan-mode refusal is visible to surfaces, never a silent drop.
    refused: modeVerdict.allowed === false,
  });

  s.history.push({
    seq,
    sessionId,
    type: event.type,
    routed: true,
    surfaces: dispatchedSurfaces,
    reason: null,
    errors: null,
    refused: envelope.refused,
    event: safeCopy(event),
  });

  /* ---- 5. Deliver: once per event, or queue if nobody listens --- */
  const live = s.subscribers.filter((sub) => !sub.disabled);
  if (live.length === 0) {
    s.queue.push(envelope);
  } else {
    deliver(s, envelope);
  }

  return {
    routed: true,
    surfaces: dispatchedSurfaces,
    event: envelope.event,
    turnId,
    seq,
    modes: modesView,
    refused: envelope.refused,
  };
}

/** Isolated delivery: one throwing handler never starves the others. */
function deliver(s, envelope) {
  const deliveredTo = [];
  for (const sub of [...s.subscribers]) {
    if (sub.disabled) continue;
    try {
      sub.handler(envelope);
      deliveredTo.push(sub.id);
    } catch (e) {
      sub.throws += 1;
      sub.disabled = true;
      s.handlerLog.push({
        subscriber: sub.id,
        seq: envelope.seq,
        type: envelope.event && envelope.event.type,
        error: (e && e.code) || 'E_HANDLER_THROW',
        message: String((e && e.message) || e),
      });
      // Loop continues — remaining handlers still receive this event.
    }
  }
  return deliveredTo;
}

export function drain(sessionId) {
  assertSessionId(sessionId);
  const s = sessionFor(sessionId);
  const pending = s.queue.splice(0, s.queue.length);
  const flushed = [];
  for (const envelope of pending) {
    deliver(s, envelope);
    flushed.push(envelope);
  }
  return { drained: flushed.length, envelopes: flushed };
}

export function history(sessionId, limit) {
  assertSessionId(sessionId);
  const s = sessionFor(sessionId);
  const all = s.history.map((h) => ({
    seq: h.seq,
    type: h.type,
    routed: h.routed,
    surfaces: h.surfaces ? [...h.surfaces] : [],
    reason: h.reason ?? null,
    errors: h.errors ? h.errors.map((e) => ({ ...e })) : null,
    refused: h.refused ?? false,
    event: h.event,
  }));
  if (typeof limit === 'number' && limit >= 0) return all.slice(-limit);
  return all;
}

/* ------------------------------------------------------------------ *
 * Inspection + probe seams
 * ------------------------------------------------------------------ */

/** Per-surface dispatch counts — proof of real dispatch and no double-render. */
export function stats(sessionId) {
  assertSessionId(sessionId);
  return { ...sessionFor(sessionId).stats };
}

/** Queued-but-undelivered count. */
export function queued(sessionId) {
  assertSessionId(sessionId);
  return sessionFor(sessionId).queue.length;
}

/** Isolated handler failures. */
export function handlerLog(sessionId) {
  assertSessionId(sessionId);
  return sessionFor(sessionId).handlerLog.map((l) => ({ ...l }));
}

export function subscriberCount(sessionId) {
  assertSessionId(sessionId);
  const s = sessionFor(sessionId);
  return { total: s.subscribers.length, active: s.subscribers.filter((x) => !x.disabled).length };
}

function safeCopy(event) {
  if (!event || typeof event !== 'object') return event ?? null;
  try {
    return Object.freeze(JSON.parse(JSON.stringify(event)));
  } catch {
    return Object.freeze({ ...event });
  }
}

export function _reset() {
  sessions.clear();
}

export function listSurfaces() {
  return [...SURFACES];
}

export function routingTable() {
  return Object.fromEntries(Object.entries(ROUTING_TABLE).map(([k, v]) => [k, [...v]]));
}

export const router = {
  subscribe,
  route,
  drain,
  history,
  stats,
  queued,
  handlerLog,
  subscriberCount,
  listSurfaces,
  routingTable,
  _reset,
};

export default router;

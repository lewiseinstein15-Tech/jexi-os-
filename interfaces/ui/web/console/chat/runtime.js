/**
 * JEXI OS — Phase 16 Scope J — Session Runtime
 *
 * A–I gave us parts. Nothing owned the SESSION: nobody opened a turn, wired
 * user input -> agent -> events -> router, closed the turn, or exposed one
 * handle for the console to talk to. This is that handle.
 *
 * Contract:
 *  runtime.attach(sessionId, opts) -> { sessionId, on(cmd), state(), detach() }
 *  runtime.send(sessionId, userInput, opts?) -> { turnId, stream: AsyncIterable }
 *  runtime.approve(sessionId, approvalId, decision) -> { accepted, ... }
 *  runtime.mode(sessionId, { displayMode?, interactionMode? }) -> { modes }
 *  runtime.replay(sessionId, turnId) -> routed events for that turn
 *
 * handle.on(cmd) accepts user-side commands:
 *  { type:'send', text } | { type:'approve', approvalId, decision }
 *  | { type:'mode', displayMode?, interactionMode? }
 *
 * Turn lifecycle: idle -> opening -> streaming -> awaiting-approval? -> closing
 *                 -> done, or -> failed.
 *
 * Rules implemented:
 *  - ONE active turn per session. A second send() throws E_TURN_ACTIVE; it is
 *    never silently queued.
 *  - Every event goes through router.route() (Scope I). The runtime builds
 *    Scope A events and has no other output path.
 *  - User input becomes: one message.delta with the user text, narration via
 *    Scope B, approval.requested via Scope G when a tool needs it, and a
 *    turn.completed at close.
 *  - Mode switches go through runtime.mode() -> Scope H. Because the router
 *    calls modes.apply() at route time, a switch affects future events only;
 *    already-buffered rows are untouched.
 *  - attach() is idempotent — the second call returns the identical handle
 *    object, and no duplicate router subscriber is created.
 *  - detach() releases the handle but does NOT close an active turn. The turn
 *    keeps running and buffering into session state, and replay() returns it
 *    on re-attach. Session state lives on the session record, never on the
 *    handle, so nothing vanishes on detach.
 *  - Turn history is bounded per session (default 50); oldest-first eviction,
 *    logged.
 *  - Deterministic: no clock and no randomness on the event path. Timestamps
 *    are derived from a fixed epoch plus a per-session event counter, which
 *    Scope A's validate() accepts (ts may be an ISO string or a number) and
 *    which keeps the stream byte-reproducible.
 *
 * Agent seam: opts.agent is an async generator yielding intents —
 *   { kind:'narrate', type, ctx } | { kind:'tool', name, args, destructive? }
 *   | { kind:'text', delta } | { kind:'fail', code, message }
 * The runtime interprets intents; it does not invent events on the agent's
 * behalf. The default agent is a deterministic keyword-driven script.
 */

import { router } from './router.js';
import { modes as modesScope } from './modes.js';
import { approvals } from './approvals.js';
import { draft } from './progress-draft.js';
import { dualPane } from './dual-pane.js';
import { narration } from '../../../../../agents/workforce/narration/index.js';

/** Fixed epoch so timestamps are reproducible run to run. */
const EPOCH_BASE_MS = 1767225600000; // 2026-01-01T00:00:00.000Z

export const STATUSES = ['idle', 'opening', 'streaming', 'awaiting-approval', 'closing', 'done', 'failed'];
export const DEFAULT_HISTORY_LIMIT = 50;
const TERMINAL = new Set(['done', 'failed']);

function fail(code, message) {
  const err = new Error(message || code);
  err.code = code;
  return err;
}

function assertSessionId(sessionId) {
  if (typeof sessionId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(sessionId)) {
    throw fail('E_INVALID_SESSION', `Invalid sessionId: ${JSON.stringify(sessionId)}`);
  }
}

/* ------------------------------------------------------------------ *
 * Session + turn records. Module-level, so they outlive any handle.
 * ------------------------------------------------------------------ */

const sessions = new Map();

function ensureSession(sessionId) {
  let s = sessions.get(sessionId);
  if (!s) {
    s = {
      sessionId,
      agentId: 'agent-runtime',
      historyLimit: DEFAULT_HISTORY_LIMIT,
      eventSeq: 0,        // deterministic timestamp counter
      turnSeq: 0,
      handle: null,
      activeTurn: null,
      lastTurn: null,     // most recent turn, so state() can report done/failed
      turns: new Map(),   // turnId -> record (bounded)
      turnOrder: [],      // completed turn ids, oldest first
      evictions: [],
      recorder: null,     // session-scoped router subscription
      lastEnvelope: null,
    };
    sessions.set(sessionId, s);
  }
  return s;
}

/**
 * One session-scoped router subscription, created once. It exists so buffered
 * entries carry the router's real per-surface delivery receipts. It is
 * deliberately NOT released by detach(): a detached active turn must keep
 * recording, or replay-on-re-attach could not work.
 */
function ensureRecorder(s) {
  if (s.recorder) return;
  s.recorder = router.subscribe(s.sessionId, (envelope) => {
    // router.route() delivers synchronously before returning, so this lands
    // inside the emit() call that caused it.
    s.lastEnvelope = envelope;
  });
}

/* ------------------------------------------------------------------ *
 * Turn stream — an AsyncIterable over the turn's buffer.
 * ------------------------------------------------------------------ */

class TurnStream {
  constructor(turn) {
    this.turn = turn;
    this.waiters = [];
  }

  notify() {
    const w = this.waiters.splice(0, this.waiters.length);
    for (const resolve of w) resolve();
  }

  [Symbol.asyncIterator]() {
    const turn = this.turn;
    const self = this;
    let i = 0;
    return {
      async next() {
        for (;;) {
          if (i < turn.buffer.length) return { value: turn.buffer[i], done: false, index: i++ };
          if (turn.finished) return { value: undefined, done: true };
          await new Promise((resolve) => self.waiters.push(resolve));
        }
      },
    };
  }
}

function createTurn(s, turnId, userInput, agent) {
  const turn = {
    turnId,
    sessionId: s.sessionId,
    userInput,
    agent,
    status: 'opening',
    buffer: [],
    events: [],
    refusals: [],
    tools: [],
    pendingApproval: null,
    error: null,
    toolSeq: 0,
    finished: false,
    draftState: null,
    pane: null,
  };
  turn.stream = new TurnStream(turn);
  return turn;
}

/* ------------------------------------------------------------------ *
 * Event construction + routing (the only output path)
 * ------------------------------------------------------------------ */

function tsFor(s) {
  s.eventSeq += 1;
  return new Date(EPOCH_BASE_MS + s.eventSeq).toISOString();
}

function buildEvent(s, type, payload) {
  return {
    type,
    version: 1,
    ts: tsFor(s),
    sessionId: s.sessionId,
    agentId: s.agentId,
    payload,
  };
}

/** Route one event and record it on the turn. Nothing bypasses this. */
function emit(s, turn, event) {
  s.lastEnvelope = null;
  const res = router.route(s.sessionId, event);
  const env = s.lastEnvelope;

  const entry = {
    seq: res.seq,
    turnId: turn.turnId,
    type: event.type,
    event: res.event,
    routed: res.routed,
    surfaces: res.surfaces,
    reason: res.reason ?? null,
    refused: res.refused ?? false,
    modes: res.modes
      ? {
          allowed: res.modes.allowed,
          reason: res.modes.reason,
          displayMode: res.modes.displayMode,
          interactionMode: res.modes.interactionMode,
          classification: res.modes.classification,
          rowOverride: res.modes.rowOverride,
        }
      : null,
    // Real per-surface delivery receipts from Scope I.
    deliveries: env ? env.deliveries.map((d) => ({ ...d })) : null,
  };

  turn.buffer.push(entry);
  turn.events.push(event);
  turn.stream.notify();
  return entry;
}

function emitNarration(s, turn, type, ctx) {
  const event = narration.emit(type, {
    ...ctx,
    agentId: s.agentId,
    sessionId: s.sessionId,
    ts: tsFor(s),
  });
  return emit(s, turn, event);
}

/* ------------------------------------------------------------------ *
 * Intent handling
 * ------------------------------------------------------------------ */

async function runTool(s, turn, intent) {
  const name = typeof intent.name === 'string' && intent.name ? intent.name : null;
  if (!name) throw fail('E_INVALID_INTENT', 'tool intent requires a name');
  const args = intent.args && typeof intent.args === 'object' ? intent.args : {};
  const destructive = intent.destructive === true;

  let approvalId = null;
  if (destructive) {
    const pending = approvals.request(turn.turnId, {
      action: name,
      payload: args,
      sessionId: s.sessionId,
    });
    approvalId = pending.approvalId;
    turn.pendingApproval = { approvalId, action: name };
    turn.status = 'awaiting-approval';

    emit(s, turn, buildEvent(s, 'approval.requested', {
      approvalId,
      reason: name,
      options: ['yes', 'no', 'always'],
    }));

    let outcome;
    try {
      outcome = await pending;
    } catch (e) {
      if (e && e.code === 'E_APPROVAL_DENIED') {
        emit(s, turn, buildEvent(s, 'approval.resolved', { approvalId, decision: 'rejected', resolver: 'user' }));
        turn.toolSeq += 1;
        emit(s, turn, buildEvent(s, 'tool.failed', {
          toolCallId: `tc-${turn.turnId}-${turn.toolSeq}`,
          toolName: name,
          error: 'E_APPROVAL_DENIED',
        }));
        turn.pendingApproval = null;
        turn.error = { code: 'E_APPROVAL_DENIED', message: `approval denied for ${name}` };
        return;
      }
      throw e;
    }

    emit(s, turn, buildEvent(s, 'approval.resolved', { approvalId, decision: 'approved', resolver: 'user' }));
    turn.pendingApproval = null;
    turn.status = 'streaming';
    void outcome;
  }

  turn.toolSeq += 1;
  const toolCallId = `tc-${turn.turnId}-${turn.toolSeq}`;

  const started = emit(s, turn, buildEvent(s, 'tool.started', { toolCallId, toolName: name, args }));

  try {
    draft.update(turn.turnId, { toolLog: [...turn.tools, `${name}(${toolCallId})`] });
  } catch { /* a draft conflict must never kill the turn */ }

  // Scope H refused the tool in plan mode: it did not run, so say so.
  if (started.refused) {
    turn.refusals.push({ toolCallId, tool: name, reason: started.reason ?? 'E_PLAN_MODE_READONLY' });
    emit(s, turn, buildEvent(s, 'tool.failed', {
      toolCallId,
      toolName: name,
      error: started.reason ?? 'E_PLAN_MODE_READONLY',
    }));
    turn.tools.push(`${name}(${toolCallId}) refused`);
    return;
  }

  emit(s, turn, buildEvent(s, 'tool.completed', {
    toolCallId,
    toolName: name,
    result: { ok: true, tool: name, approvalId },
  }));
  turn.tools.push(`${name}(${toolCallId}) ok`);
}

async function handleIntent(s, turn, intent) {
  if (!intent || typeof intent.kind !== 'string') {
    throw fail('E_INVALID_INTENT', `intent.kind missing: ${JSON.stringify(intent)}`);
  }
  switch (intent.kind) {
    case 'narrate':
      emitNarration(s, turn, intent.type, intent.ctx || {});
      return;
    case 'tool':
      await runTool(s, turn, intent);
      return;
    case 'text':
      emit(s, turn, buildEvent(s, 'message.delta', {
        delta: String(intent.delta ?? ''),
        messageId: `msg-${turn.turnId}-${turn.buffer.length}`,
      }));
      return;
    case 'fail':
      turn.error = { code: intent.code || 'E_AGENT_FAILED', message: String(intent.message || 'agent failed') };
      return;
    default:
      throw fail('E_UNKNOWN_INTENT', `Unknown intent kind: ${intent.kind}`);
  }
}

/* ------------------------------------------------------------------ *
 * The turn loop
 * ------------------------------------------------------------------ */

async function runTurn(s, turn) {
  let draftCreated = false;
  try {
    turn.status = 'opening';
    try {
      turn.draftState = draft.create(turn.turnId, { headline: `Turn ${turn.turnId}`, force: true });
      draftCreated = true;
    } catch (e) {
      // Scope D allows only one globally-active draft; never fatal to the turn.
      turn.draftState = { error: (e && e.code) || 'E_DRAFT_ERROR' };
    }

    // The user's text becomes exactly one message.delta.
    emit(s, turn, buildEvent(s, 'message.delta', {
      delta: turn.userInput,
      messageId: `msg-${turn.turnId}-user`,
    }));

    turn.status = 'streaming';

    const ctx = { sessionId: s.sessionId, turnId: turn.turnId, userInput: turn.userInput, agentId: s.agentId };
    for await (const intent of turn.agent(ctx)) {
      await handleIntent(s, turn, intent);
      if (turn.error) break;
    }

    if (turn.error) {
      turn.status = 'closing';
      emit(s, turn, buildEvent(s, 'turn.completed', {
        turnId: turn.turnId,
        status: 'fail',
        error: turn.error.code,
      }));
      turn.status = 'failed';
    } else {
      turn.status = 'closing';
      emit(s, turn, buildEvent(s, 'turn.completed', { turnId: turn.turnId, status: 'ok' }));
      turn.status = 'done';
    }
  } catch (e) {
    turn.error = { code: (e && e.code) || 'E_TURN_ERROR', message: String((e && e.message) || e) };
    turn.status = 'failed';
    try {
      emit(s, turn, buildEvent(s, 'turn.completed', {
        turnId: turn.turnId,
        status: 'fail',
        error: turn.error.code,
      }));
    } catch { /* the turn is already failed; do not throw from the failure path */ }
  } finally {
    if (draftCreated) {
      try {
        turn.draftState = draft.finalize(turn.turnId, finalMessage(turn));
      } catch (e) {
        turn.draftState = { error: (e && e.code) || 'E_DRAFT_ERROR' };
      }
    }
    // Scope E: split the turn's events and collapse the process side.
    try {
      const { processEvents, resultEvents } = dualPane.split(turn.events);
      turn.pane = {
        processCount: processEvents.length,
        resultCount: resultEvents.length,
        collapse: processEvents.length ? dualPane.collapse(processEvents) : null,
      };
    } catch (e) {
      turn.pane = { error: (e && e.code) || 'E_PANE_ERROR' };
    }
    completeTurn(s, turn);
  }
}

function finalMessage(turn) {
  if (turn.error) return `turn failed: ${turn.error.code}`;
  return `turn ${turn.turnId} completed with ${turn.tools.length} tool call(s)`;
}

function completeTurn(s, turn) {
  turn.finished = true;
  turn.stream.notify();
  if (s.activeTurn === turn) s.activeTurn = null;
  s.lastTurn = turn;

  s.turnOrder.push(turn.turnId);
  while (s.turnOrder.length > s.historyLimit) {
    const evicted = s.turnOrder.shift();
    s.turns.delete(evicted);
    s.evictions.push({
      turnId: evicted,
      reason: 'E_HISTORY_BOUND',
      limit: s.historyLimit,
      retained: s.turnOrder.length,
    });
  }
}

/* ------------------------------------------------------------------ *
 * Default agent — deterministic, keyword driven.
 * ------------------------------------------------------------------ */

const WRITE_INTENT_RE = /\b(write|create|edit|delete|remove|run|exec|install|deploy)\b/i;

function defaultAgent(ctx) {
  return (async function* agent() {
    yield { kind: 'narrate', type: 'acknowledge', ctx: { input: ctx.userInput, source: `input:${ctx.turnId}` } };

    if (WRITE_INTENT_RE.test(ctx.userInput)) {
      yield {
        kind: 'tool',
        name: 'write_file',
        args: { path: '/tmp/out.txt', content: ctx.userInput },
        destructive: true,
      };
    } else {
      yield { kind: 'tool', name: 'read_file', args: { path: '/tmp/in.txt' }, destructive: false };
    }

    yield { kind: 'narrate', type: 'completion', ctx: { built: 'the requested change', source: `turn:${ctx.turnId}` } };
  })();
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

export function attach(sessionId, opts = {}) {
  assertSessionId(sessionId);
  const s = ensureSession(sessionId);
  ensureRecorder(s);

  // Idempotent: the same handle object comes back, no new subscriber.
  if (s.handle) return s.handle;

  if (opts && typeof opts === 'object') {
    if (typeof opts.agent === 'function') s.agent = opts.agent;
    if (typeof opts.agentId === 'string' && opts.agentId) s.agentId = opts.agentId;
    if (typeof opts.historyLimit === 'number' && opts.historyLimit > 0) s.historyLimit = opts.historyLimit;
  }

  const handle = {
    sessionId,
    _detached: false,
    _opts: opts || {},

    on(cmd) {
      if (handle._detached) throw fail('E_DETACHED', `handle for ${sessionId} is detached`);
      if (!cmd || typeof cmd.type !== 'string') {
        throw fail('E_UNKNOWN_COMMAND', 'command.type is required');
      }
      switch (cmd.type) {
        case 'send':
          return send(sessionId, cmd.text, cmd.opts);
        case 'approve':
          return approve(sessionId, cmd.approvalId, cmd.decision);
        case 'mode':
          return mode(sessionId, cmd);
        default:
          throw fail('E_UNKNOWN_COMMAND', `Unknown command type: ${cmd.type}`);
      }
    },

    state() {
      if (handle._detached) throw fail('E_DETACHED', `handle for ${sessionId} is detached`);
      return stateOf(s);
    },

    detach() {
      if (handle._detached) return { sessionId, detached: false, alreadyDetached: true };
      handle._detached = true;
      handle._opts = {};
      // The active turn is NOT closed — it keeps running and buffering.
      if (s.handle === handle) s.handle = null;
      return { sessionId, detached: true, activeTurnId: s.activeTurn ? s.activeTurn.turnId : null };
    },
  };

  s.handle = handle;
  return handle;
}

export function send(sessionId, userInput, opts) {
  assertSessionId(sessionId);
  if (typeof userInput !== 'string' || userInput.length === 0) {
    throw fail('E_INVALID_INPUT', 'userInput must be a non-empty string');
  }
  const s = ensureSession(sessionId);
  ensureRecorder(s);

  if (s.activeTurn && !TERMINAL.has(s.activeTurn.status)) {
    throw fail(
      'E_TURN_ACTIVE',
      `turn ${s.activeTurn.turnId} is ${s.activeTurn.status}; one active turn per session`
    );
  }

  const agent = (opts && typeof opts.agent === 'function') ? opts.agent : (s.agent || defaultAgent);

  s.turnSeq += 1;
  const turnId = `${sessionId}:turn-${s.turnSeq}`;
  const turn = createTurn(s, turnId, userInput, agent);
  s.turns.set(turnId, turn);
  s.activeTurn = turn;

  // Runs on microtasks; buffered whether or not anyone iterates the stream.
  runTurn(s, turn).catch((e) => {
    turn.error = { code: (e && e.code) || 'E_TURN_ERROR', message: String((e && e.message) || e) };
    turn.status = 'failed';
    completeTurn(s, turn);
  });

  return { turnId, stream: turn.stream };
}

export function approve(sessionId, approvalId, decision) {
  assertSessionId(sessionId);
  ensureSession(sessionId);
  // Scope G owns the decision; its named errors propagate.
  const res = approvals.resolve(approvalId, decision);
  return { accepted: true, approvalId: res.approvalId, decision: res.decision };
}

export function mode(sessionId, patch = {}) {
  assertSessionId(sessionId);
  ensureSession(sessionId);
  if (patch && patch.displayMode !== undefined) modesScope.setDisplayMode(sessionId, patch.displayMode);
  if (patch && patch.interactionMode !== undefined) modesScope.setInteractionMode(sessionId, patch.interactionMode);
  return { modes: modesScope.get(sessionId) };
}

export function replay(sessionId, turnId) {
  assertSessionId(sessionId);
  const s = ensureSession(sessionId);
  const turn = s.turns.get(turnId);
  if (!turn) throw fail('E_UNKNOWN_TURN', `Unknown turnId: ${turnId}`);
  return turn.buffer.map((e) => ({ ...e }));
}

export function stateOf(s) {
  // Fall back to the last turn so a finished turn still reports its terminal
  // status (done/failed); 'idle' means no turn has run on this session yet.
  const t = s.activeTurn || s.lastTurn;
  return {
    turnId: t ? t.turnId : undefined,
    status: t ? t.status : 'idle',
    modes: modesScope.get(s.sessionId),
    pending: approvals.pending(s.sessionId).length,
    turns: s.turnOrder.length,
    evictions: s.evictions.length,
  };
}

/* ------------------------------------------------------------------ *
 * Inspection + probe seams
 * ------------------------------------------------------------------ */

export function state(sessionId) {
  assertSessionId(sessionId);
  return stateOf(ensureSession(sessionId));
}

export function turnInfo(sessionId, turnId) {
  assertSessionId(sessionId);
  const turn = ensureSession(sessionId).turns.get(turnId);
  if (!turn) throw fail('E_UNKNOWN_TURN', `Unknown turnId: ${turnId}`);
  return {
    turnId: turn.turnId,
    status: turn.status,
    finished: turn.finished,
    eventCount: turn.buffer.length,
    tools: [...turn.tools],
    refusals: turn.refusals.map((r) => ({ ...r })),
    error: turn.error ? { ...turn.error } : null,
    draftState: turn.draftState,
    pane: turn.pane,
  };
}

export function evictions(sessionId) {
  assertSessionId(sessionId);
  return ensureSession(sessionId).evictions.map((e) => ({ ...e }));
}

export function retainedTurns(sessionId) {
  assertSessionId(sessionId);
  return [...ensureSession(sessionId).turnOrder];
}

export function isAttached(sessionId) {
  assertSessionId(sessionId);
  const s = sessions.get(sessionId);
  return !!(s && s.handle && !s.handle._detached);
}

/** Wait until the session's active turn (if any) reaches a terminal state. */
export async function settle(sessionId) {
  assertSessionId(sessionId);
  const s = ensureSession(sessionId);
  while (s.activeTurn && !TERMINAL.has(s.activeTurn.status)) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  // Completion nulls activeTurn, so fall back to lastTurn — settle() should
  // report how the turn ended, not 'idle'.
  const t = s.activeTurn || s.lastTurn;
  return t ? t.status : 'idle';
}

export function configure(sessionId, patch = {}) {
  assertSessionId(sessionId);
  const s = ensureSession(sessionId);
  if (typeof patch.agent === 'function') s.agent = patch.agent;
  if (typeof patch.agentId === 'string' && patch.agentId) s.agentId = patch.agentId;
  if (typeof patch.historyLimit === 'number' && patch.historyLimit > 0) s.historyLimit = patch.historyLimit;
  return { historyLimit: s.historyLimit, agentId: s.agentId };
}

export function _reset() {
  for (const s of sessions.values()) {
    if (s.recorder) { s.recorder(); s.recorder = null; }
  }
  sessions.clear();
}

export const runtime = {
  attach,
  send,
  approve,
  mode,
  replay,
  state,
  turnInfo,
  evictions,
  retainedTurns,
  isAttached,
  settle,
  configure,
  listStatuses: () => [...STATUSES],
  _reset,
};

export default runtime;

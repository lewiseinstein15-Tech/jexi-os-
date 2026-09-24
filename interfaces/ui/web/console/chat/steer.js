/**
 * JEXI OS — Phase 16 Scope M — Steer (mid-turn injection)
 *
 * STEER lets the user redirect a turn that is ALREADY streaming. Unlike the
 * queue (which holds a message for the NEXT turn), a steer is injected into the
 * CURRENT turn's next decision point and the agent must respond to it. It never
 * creates a second turn — Scope J's one-active-turn-per-session contract holds.
 *
 * How injection works WITHOUT editing runtime.js (Scope J):
 *  - Scope J's agent seam is an async generator yielding intents
 *    ({kind:'tool'} | {kind:'text'} | {kind:'narrate'} | {kind:'fail'}).
 *  - queue.js dispatches every turn through steer.wrapAgent(), which wraps the
 *    caller's base agent. Between the base agent's yields — i.e. after the
 *    current tool.completed and before the next tool.started — the wrapper
 *    drains this module's per-turn buffer and yields the pending steers as a
 *    {kind:'narrate', type:'correction'} (→ a routed narration.line carrying
 *    ctx.steer='delivered') followed by a {kind:'text'} (→ a message.delta with
 *    the steer text). The steer therefore lands on the turn's next event
 *    boundary inside the SAME turnId.
 *  - While a turn is awaiting-approval the base generator is suspended inside
 *    runTool, so the wrapper cannot drain; the steer simply stays buffered and
 *    is delivered as soon as approval resolves and the generator resumes —
 *    exactly the required "buffer until approval resolves" behaviour.
 *
 * Taxonomy gap (Scope A is read-only here): the queue.* and steer.* event
 * types do not exist, so every steer surface event is emitted as a VALID
 * narration.line
 * (narrationType 'correction') with a structured `ctx` payload
 * (ctx.steer = 'injected' | 'delivered'). The gap is reported, not papered over.
 *
 * Bounds: at most STEER_BOUND (8) undelivered steers per turn; overflow throws
 * E_STEER_FULL. Steer on a session with no active (non-terminal) turn throws
 * E_NO_ACTIVE_TURN.
 */

import { runtime } from './runtime.js';
import { router } from './router.js';

export const STEER_BOUND = 8;
const TS_BASE = 1767225600000; // mirrors Scope J's epoch base for deterministic ts

function fail(code, message) {
  const err = new Error(message || code);
  err.code = code;
  return err;
}

let steerSeq = 0;
let tsSeq = 0;

/** turnId -> Array<{ steerId, message, injectedAt, delivered }> */
const buffers = new Map();

function buf(turnId) {
  if (!buffers.has(turnId)) buffers.set(turnId, []);
  return buffers.get(turnId);
}

function activeTurn(sessionId) {
  const st = runtime.state(sessionId);
  if (!st.turnId) return null;
  if (st.status === 'done' || st.status === 'failed' || st.status === 'idle') return null;
  return st;
}

/** Emit a steer surface event as a valid narration.line with structured ctx. */
function emitSteer(sessionId, phase, turnId, entry) {
  tsSeq += 1;
  const evt = {
    type: 'narration.line',
    version: 1,
    ts: TS_BASE + tsSeq,
    sessionId,
    agentId: 'agent-runtime',
    payload: {
      narrationType: 'correction',
      text: phase === 'injected' ? `steer injected: ${entry.message}` : `steer delivered: ${entry.message}`,
      ctx: { steer: phase, steerId: entry.steerId, turnId },
      turnId,
    },
  };
  return router.route(sessionId, evt);
}

/**
 * Inject a steer into the session's active turn.
 * @returns {{ steerId: string, appliedTo: string }}
 */
export function inject(sessionId, message) {
  if (typeof message !== 'string' || !message) throw fail('E_INVALID_INPUT', 'steer message required');
  const st = activeTurn(sessionId);
  if (!st) throw fail('E_NO_ACTIVE_TURN', `no active turn on ${sessionId}`);

  const pendingNow = buf(st.turnId).filter((e) => !e.delivered);
  if (pendingNow.length >= STEER_BOUND) {
    throw fail('E_STEER_FULL', `steer bound ${STEER_BOUND} reached for ${st.turnId}`);
  }

  steerSeq += 1;
  const entry = {
    steerId: `${sessionId}:s-${steerSeq}`,
    message,
    injectedAt: TS_BASE + (++tsSeq),
    delivered: false,
  };
  buf(st.turnId).push(entry);
  emitSteer(sessionId, 'injected', st.turnId, entry);
  return { steerId: entry.steerId, appliedTo: st.turnId };
}

/** Undelivered steers for the session's active turn. */
export function pending(sessionId) {
  const st = runtime.state(sessionId);
  if (!st.turnId) return [];
  return buf(st.turnId).filter((e) => !e.delivered).map((e) => ({ ...e }));
}

/** Drain (and mark delivered) the pending steers for a turn. Internal seam. */
export function _consume(turnId) {
  const out = [];
  for (const e of buf(turnId)) {
    if (!e.delivered) { e.delivered = true; out.push({ ...e }); }
  }
  return out;
}

/**
 * Wrap a base agent so pending steers are injected at each yield boundary.
 * The wrapper yields, per steer, a correction narration then the steer text,
 * immediately before the base agent's next intent (i.e. before the next
 * tool.started / after the current tool.completed).
 */
export function wrapAgent(baseAgent) {
  return function steeredAgent(ctx) {
    const base = baseAgent(ctx);
    return (async function* run() {
      for await (const intent of base) {
        for (const st of _consume(ctx.turnId)) {
          yield { kind: 'narrate', type: 'correction', ctx: { source: `steer:${st.steerId}`, next: st.message, ctx: { steer: 'delivered', steerId: st.steerId, turnId: ctx.turnId } } };
          yield { kind: 'text', delta: `[steer] ${st.message}` };
        }
        yield intent;
      }
      // Flush any steer that arrived after the last base yield (still same turn).
      for (const st of _consume(ctx.turnId)) {
        yield { kind: 'narrate', type: 'correction', ctx: { source: `steer:${st.steerId}`, next: st.message, ctx: { steer: 'delivered', steerId: st.steerId, turnId: ctx.turnId } } };
        yield { kind: 'text', delta: `[steer] ${st.message}` };
      }
    })();
  };
}

export function _reset() {
  buffers.clear();
  steerSeq = 0;
  tsSeq = 0;
}

export const steer = { inject, pending, wrapAgent, _consume, _reset, STEER_BOUND };
export default steer;

/**
 * JEXI OS — Phase 20 Scope F — Ralph (persistent retry loop).
 *
 * Ported from the ruflo ralph / "Wiggum loop" pattern: an agent that keeps
 * trying with adjusted context after each failure, until success or budget
 * exhausted.
 *
 *   ralph.run(task, { maxAttempts, adjustContext, initialContext })
 *     -> { attempts, result, stoppedBy, contextLog[] }
 *        stoppedBy: 'success' | 'max-attempts'
 *
 * `task` is the attempted work: fn(context, attempt) -> { ok: true, ... }
 * on success or { ok: false, failure } on a handled failure; a thrown error
 * is a failure whose reason is the error message.
 *
 * Semantics:
 * - Attempt 1 runs with initialContext (default undefined). After each
 *   failure, the next context is adjustContext(prevContext, failure); with
 *   no adjuster the context carries over unchanged.
 * - contextLog records { attempt, context, failure? } for every attempt —
 *   the success attempt has no failure field.
 * - Success -> stoppedBy 'success', attempts = ACTUAL count, result = the
 *   successful result. Exhaustion -> 'max-attempts', result = the last
 *   failure record.
 * - Deterministic given the same task and adjuster.
 */
import { SwarmError } from '../topologies/_internal.js';
import { evaluate as evaluateLoopPolicy } from '../../harness/hardening/ralph/diagnostics.js';

export const DEFAULT_MAX_ATTEMPTS = 5;

export function run(task, opts = {}) {
  const {
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    adjustContext,
    initialContext,
  } = opts;

  if (typeof task !== 'function') {
    throw new SwarmError('E_INVALID_TASK', `task must be a function (context, attempt) => result, got ${typeof task}`);
  }
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new SwarmError('E_INVALID_MAX_ATTEMPTS', `maxAttempts must be an integer >= 1, got ${JSON.stringify(maxAttempts)}`);
  }
  if (adjustContext !== undefined && typeof adjustContext !== 'function') {
    throw new SwarmError('E_INVALID_ADJUSTER', `adjustContext must be a function or undefined, got ${typeof adjustContext}`);
  }

  let context = initialContext;
  const contextLog = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let outcome;
    try {
      outcome = task(context, attempt);
    } catch (err) {
      outcome = { ok: false, failure: err.message };
    }
    if (!outcome || typeof outcome !== 'object' || typeof outcome.ok !== 'boolean') {
      throw new SwarmError('E_INVALID_OUTCOME', `attempt ${attempt} must return { ok: boolean, ... }, got ${JSON.stringify(outcome)}`);
    }

    if (outcome.ok) {
      contextLog.push({ attempt, context });
      return { attempts: attempt, result: outcome, stoppedBy: 'success', contextLog };
    }

    const failure = outcome.failure !== undefined ? outcome.failure : 'unspecified failure';
    contextLog.push({ attempt, context, failure });
    if (adjustContext) context = adjustContext(context, failure);
  }

  return {
    attempts: maxAttempts,
    result: { ok: false, failure: contextLog[contextLog.length - 1].failure },
    stoppedBy: 'max-attempts',
    contextLog,
  };
}

export default { DEFAULT_MAX_ATTEMPTS, run };

/* ── W23e wiring (Phase 31 Scope 3): ralph diagnostics at the loop checkpoint ──
 * Wiring import + register call ONLY — the run() body above is untouched.
 * The checkpoint seam is the shipped `adjustContext` option (fires after every
 * failed attempt): a consumer's adjuster calls emitCheckpoint() with the
 * iteration props, and every handler registered here receives them. The
 * shipped loop-policy evaluator (harness/hardening/ralph/diagnostics.js) is
 * pre-registered below as the default handler. No new error class — reuses
 * SwarmError from the import above. */
const checkpointHandlers = new Set();

/** Register a checkpoint handler; returns its unsubscribe fn. */
export function registerCheckpointHandler(handler) {
  if (typeof handler !== 'function') {
    throw new SwarmError('E_INVALID_CHECKPOINT_HANDLER', `checkpoint handler must be a function, got ${typeof handler}`);
  }
  checkpointHandlers.add(handler);
  return () => checkpointHandlers.delete(handler);
}

/** Invoke every registered checkpoint handler; findings come back in order. */
export function emitCheckpoint(props) {
  const results = [];
  for (const handler of checkpointHandlers) results.push(handler(props));
  return results;
}

/** W23e register call: the shipped policy evaluator is the default checkpoint handler. */
export const defaultCheckpointRegistration = registerCheckpointHandler(
  (props) => evaluateLoopPolicy(props)
);
